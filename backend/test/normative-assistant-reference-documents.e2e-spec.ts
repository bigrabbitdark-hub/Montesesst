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

describe('POST /assistant/normative-query — material de referência sem fonte oficial (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let tokenEmpresa: string;
  let documentId: string;
  let chunkId: string;
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
    const client = (db as any).client;

    redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(ASSISTANT_RATE_LIMIT_KEY);

    const tenant = await db.createTenantWithUser('Empresa Assistente Referência Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    // Admin criado pelo próprio teste (mesmo padrão da Task 10,
    // reference-documents-approval.e2e-spec.ts) — o fixture não deve
    // depender de um usuário role='admin' pré-existente no banco (o banco
    // de ensaio roda só com o schema das migrations, sem seed).
    const admin = await db.createUserWithRole('admin', 'Admin Referencia Assistente Teste');

    const doc = await client.query(
      `INSERT INTO reference_documents
         (title, category, origin_note, status, content_hash, file_key, file_name, mime_type, raw_text, uploaded_by_user_id, indexed_at)
       VALUES ('Cartilha EPI Teste', 'EPI', 'Fixture de teste — suíte e2e', 'vigente', 'hash-teste-referencia-e2e',
               'reference/teste/cartilha.pdf', 'cartilha.pdf', 'application/pdf', 'Texto completo da cartilha de teste.',
               $1, now())
       RETURNING id`,
      [admin.userId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO reference_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, 'Use protetor auricular tipo concha em ambientes acima de 85dB.', $2::vector)
       RETURNING id`,
      [documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;
  });

  afterEach(async () => {
    fakeAnswer.mockReset();
    await redis.del(ASSISTANT_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM reference_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM reference_documents WHERE id = $1', [documentId]);
    await db.cleanup();
    await db.disconnect();
    await redis.quit();
    await app.close();
  });

  it('inclui reference_ref_ids e reference_citations quando o provider cita um trecho de referência', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'Recomenda-se usar protetor auricular tipo concha acima de 85dB.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        reference_ref_ids: [chunkId],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Que proteção usar contra ruído alto?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('protetor auricular');
    expect(res.body.reference_citations).toEqual([
      { document_id: documentId, title: 'Cartilha EPI Teste', category: 'EPI' },
    ]);

    const answerArgs = fakeAnswer.mock.calls[0];
    const referenceItemsArg = answerArgs[5];
    expect(referenceItemsArg.some((r: any) => r.id === chunkId)).toBe(true);
  });

  it('descarta o claim quando reference_ref_ids aponta pra um id que não veio na busca', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'Afirmação com id de referência inventado.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        reference_ref_ids: ['00000000-0000-0000-0000-000000000000'],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Que proteção usar contra ruído alto?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.reference_citations).toEqual([]);
  });
});
