import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { TestDb } from './db-test-helper';

// A coluna normative_document_chunks.embedding é vector(1536) (migration
// 0021_normative_base.sql) — o Postgres rejeita qualquer array de
// dimensão diferente ("expected 1536 dimensions, not N"), então o fake
// do EMBEDDING_PROVIDER precisa devolver um vetor de 1536 posições,
// mesmo padrão já usado em normative-pgvector.e2e-spec.ts.
function fakeEmbeddingVector(): number[] {
  return new Array(1536).fill(0.001);
}

describe('Fluxo de aprovação/indexação de normative_documents (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let sourceId: string;
  let fakeEmbed: jest.Mock;

  beforeAll(async () => {
    fakeEmbed = jest.fn().mockResolvedValue(fakeEmbeddingVector());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Aprovacao Normativa Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const src = await (db as any).client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-APROVACAO', 'Norma teste aprovacao', 'https://exemplo.gov.br/aprovacao.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
  });

  afterEach(() => {
    fakeEmbed.mockClear();
    fakeEmbed.mockResolvedValue(fakeEmbeddingVector());
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_document_chunks WHERE document_id IN (SELECT id FROM normative_documents WHERE source_id = $1)', [sourceId]);
    await client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function insertPendingDocument(text: string) {
    const res = await (db as any).client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, 'aguardando_validacao', $2, $3, $3, 'text/html', $4) RETURNING id`,
      [sourceId, `hash-${Date.now()}-${Math.random()}`, `normative/${sourceId}/teste.html`, text],
    );
    return res.rows[0].id;
  }

  it('aprova, indexa em chunks com embedding, e marca indexed_at', async () => {
    const documentId = await insertPendingDocument('Texto curto de norma para indexar.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).not.toBeNull();

    const chunks = await (db as any).client.query(
      'SELECT chunk_index FROM normative_document_chunks WHERE document_id = $1 ORDER BY chunk_index',
      [documentId],
    );
    expect(chunks.rows).toHaveLength(1);
    expect(fakeEmbed).toHaveBeenCalledTimes(1);
  });

  it('segunda aprovação da mesma fonte substitui a vigente anterior', async () => {
    const documentId = await insertPendingDocument('Texto novo que substitui o anterior.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.supersedes_document_id).not.toBeNull();

    const vigentes = await (db as any).client.query(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
      [sourceId],
    );
    expect(vigentes.rows).toHaveLength(1);
    expect(vigentes.rows[0].id).toBe(documentId);

    const anterior = await (db as any).client.query(
      `SELECT status FROM normative_documents WHERE id = $1`,
      [res.body.supersedes_document_id],
    );
    expect(anterior.rows[0].status).toBe('substituido');
  });

  it('falha na indexação deixa indexed_at nulo, mas a aprovação não é desfeita', async () => {
    const documentId = await insertPendingDocument('Texto que vai falhar ao indexar.');
    fakeEmbed.mockRejectedValueOnce(new Error('falha simulada no provedor de embedding'));

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).toBeNull();
  });

  it('reindex reprocessa um documento vigente com indexação pendente', async () => {
    const documentId = await insertPendingDocument('Texto pra reindexar depois.');
    fakeEmbed.mockRejectedValueOnce(new Error('falha simulada'));
    await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reindex`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.indexed_at).not.toBeNull();
  });

  it('rejeita com motivo', async () => {
    const documentId = await insertPendingDocument('Texto que vai ser rejeitado.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reject`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ reason: 'Fonte extraiu texto corrompido, revisar manualmente.' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejeitado');
    expect(res.body.rejection_reason).toBe('Fonte extraiu texto corrompido, revisar manualmente.');
  });

  it('download só funciona pra documento vigente', async () => {
    const pendingId = await insertPendingDocument('Ainda não aprovado.');
    const pendingRes = await request(app.getHttpServer())
      .get(`/normative-documents/${pendingId}/download`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(pendingRes.status).toBe(404);
  });
});
