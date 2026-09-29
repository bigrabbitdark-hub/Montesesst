import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { TestDb } from './db-test-helper';

const ASSISTANT_RATE_LIMIT_KEY = 'ratelimit:NormativeAssistantController.query:::ffff:127.0.0.1';

describe('POST /assistant/normative-query — trechos de documento da empresa (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenEmpresa: string;
  let tenantId: string;
  let documentId: string;
  let chunkId: string;
  // Segundo tenant, só pra provar isolamento cross-tenant (ver describe
  // "isolamento cross-tenant" abaixo) — mesmo embedding do chunk de A de
  // propósito: se o filtro de tenant falhasse, o chunk de B seria o match
  // de maior similaridade (idêntico) pra pergunta de A, não um "quase
  // acerto" que poderia passar despercebido por coincidência.
  let tokenEmpresaB: string;
  let tenantIdB: string;
  let documentIdB: string;
  let chunkIdB: string;
  const fakeAnswer = jest.fn();
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

    const redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(ASSISTANT_RATE_LIMIT_KEY);
    await redis.quit();

    const tenant = await db.createTenantWithUser('Empresa Doc Chunk Assistente Teste');
    tenantId = tenant.tenantId;
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const client = (db as any).client;
    const doc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Teste Assistente', 'fixture/pgr-teste.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, tenant.userId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
       VALUES ($1, $2, 'pgr', 0, 'Trecho do PGR sobre risco de ruído na função de soldador.', $3::vector)
       RETURNING id`,
      [tenantId, documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;

    // Segundo tenant (B), mesmo embedding do chunk de A — ver comentário
    // do campo tokenEmpresaB acima.
    const tenantB = await db.createTenantWithUser('Empresa Doc Chunk Assistente Teste B');
    tenantIdB = tenantB.tenantId;
    const loginEmpresaB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenEmpresaB = loginEmpresaB.body.access_token;

    const docB = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Teste Assistente B', 'fixture/pgr-teste-b.pdf', 'pgr-b.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantIdB, tenantB.userId],
    );
    documentIdB = docB.rows[0].id;

    const chunkB = await client.query(
      `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
       VALUES ($1, $2, 'pgr', 0, 'Trecho do PGR da Empresa B sobre risco elétrico em painel energizado.', $3::vector)
       RETURNING id`,
      [tenantIdB, documentIdB, exactVector],
    );
    chunkIdB = chunkB.rows[0].id;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_document_chunks WHERE id = $1', [chunkId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    await (db as any).client.query('DELETE FROM company_document_chunks WHERE id = $1', [chunkIdB]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentIdB]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa: recupera o trecho do próprio PGR e cita como company_citations', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'O PGR identifica risco de ruído na função de soldador.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [chunkId],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'o que meu PGR diz sobre ruído?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('risco de ruído');
    expect(res.body.company_citations).toEqual([
      { document_id: documentId, title: 'PGR Teste Assistente', category: 'pgr' },
    ]);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const companyChunksArg = lastCall[3];
    expect(companyChunksArg).toEqual([{ id: chunkId, content: 'Trecho do PGR sobre risco de ruído na função de soldador.' }]);
  });

  it('afirmação com company_chunk_id inválido (alucinado) é descartada pelo Verificador', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Afirmação com id inventado.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: ['id-que-nao-existe'],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'o que meu PGR diz sobre ruído?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.company_citations).toEqual([]);
  });

  // ITEM 011 da auditoria do Assistente (2026-09-28): faltava um e2e
  // direto de isolamento cross-tenant pra company_document_chunks — só
  // existia pra itens operacionais (dashboard) e pro bloqueio 403 de
  // técnico não vinculado. A proteção em código (tenantId explícito na
  // query SQL + RLS de 4 branches) já existia; este teste prova com dado
  // real que ela funciona ponta a ponta pela rota HTTP de verdade.
  it('isolamento cross-tenant: empresa A nunca recebe chunk da empresa B, mesmo com embedding idêntico', async () => {
    fakeAnswer.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'o que meu PGR diz sobre risco elétrico?' });

    expect(res.status).toBe(201);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const companyChunksArg = lastCall[3];
    const companyChunkIds = companyChunksArg.map((c: { id: string }) => c.id);
    const companyChunkContents = companyChunksArg.map((c: { content: string }) => c.content);

    expect(companyChunkIds).not.toContain(chunkIdB);
    expect(companyChunkContents.join(' ')).not.toContain('Empresa B');
    // Confirma que a busca de fato rodou (não passou vazio por outro motivo)
    // e trouxe só o chunk do próprio tenant.
    expect(companyChunkIds).toEqual([chunkId]);
  });

  it('isolamento cross-tenant: empresa B nunca recebe chunk da empresa A, mesmo com embedding idêntico', async () => {
    fakeAnswer.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresaB}`)
      .send({ question: 'o que meu PGR diz sobre risco de ruído?' });

    expect(res.status).toBe(201);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const companyChunksArg = lastCall[3];
    const companyChunkIds = companyChunksArg.map((c: { id: string }) => c.id);
    const companyChunkContents = companyChunksArg.map((c: { content: string }) => c.content);

    expect(companyChunkIds).not.toContain(chunkId);
    expect(companyChunkContents.join(' ')).not.toContain('soldador');
    expect(companyChunkIds).toEqual([chunkIdB]);
  });
});
