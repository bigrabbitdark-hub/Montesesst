import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { toVectorLiteral } from '../src/normative/vector.util';
import { TestDb } from './db-test-helper';

describe('POST /assistant/normative-query (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  const fakeAnswer = jest.fn();
  // Capturado à parte (em vez de um objeto anônimo) para que um teste
  // isolado possa sobrepor a resposta uma única vez com
  // mockResolvedValueOnce e verificar, via este mesmo spy, que o
  // provedor de resposta nunca é chamado quando nenhum chunk atinge o
  // limiar de similaridade — sem afetar o valor padrão usado pelos
  // demais testes.
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Assistente Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Assistente Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const client = (db as any).client;
    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-ASSISTENTE', 'Norma teste assistente', 'https://exemplo.gov.br/assistente.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;

    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-assistente', 'normative/assistente.html', 'assistente.html', 'text/html', 'Texto vigente de teste', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, 'Trecho oficial sobre uso de capacete.', $2::vector) RETURNING id`,
      [documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia admin com 403 (admin não é usuário final do Assistente)', async () => {
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ question: 'preciso usar capacete?' });
    expect(res.status).toBe(403);
  });

  it('responde com citação quando o Verificador confirma o chunk_id', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'É obrigatório o uso de capacete.', chunk_ids: [chunkId] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('É obrigatório o uso de capacete.');
    expect(res.body.citations).toEqual([
      { document_id: documentId, title: 'Norma teste assistente', official_url: 'https://exemplo.gov.br/assistente.html' },
    ]);
  });

  it('Verificador descarta claim com chunk_id fora do conjunto recuperado', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'Afirmação sem fonte válida.', chunk_ids: ['00000000-0000-0000-0000-000000000000'] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei uma norma vigente na base que trate disso.');
    expect(res.body.citations).toEqual([]);
  });

  it('claim com chunk_ids vazio é descartada', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'Afirmação sem citação nenhuma.', chunk_ids: [] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.body.answer).toBeNull();
  });

  it('não chama o provedor de resposta quando nenhum chunk atinge o limiar de similaridade', async () => {
    // Vetor ortogonal ao do chunk indexado ([1,0,0,...]) — similaridade
    // de cosseno 0, bem abaixo do limiar padrão (0.75), então a busca
    // retorna zero chunks relevantes.
    fakeEmbed.mockResolvedValueOnce(new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0)));

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta sem nenhuma relação com a base indexada' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei uma norma vigente na base que trate disso.');
    expect(res.body.citations).toEqual([]);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });
});
