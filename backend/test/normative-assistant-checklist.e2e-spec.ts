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

// nr_codes das fixtures deste arquivo. A limpeza é por nr_code (não só por
// id): se uma execução anterior morreu no meio, o id daquela execução se
// perdeu e o DELETE por id deixaria as linhas de fixture vazando pra tabela
// real do catálogo — o que polui retrieval de qualquer outra suíte.
const FIXTURE_NR_CODES = ['NR-ASSISTENTE-TESTE', 'NR-98'];

describe('POST /assistant/normative-query — checklist interno (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let tokenEmpresa: string;
  let checklistItemId: string;
  let verifierItemId: string;
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
    await client.query('DELETE FROM sst_checklist_items WHERE nr_code = ANY($1::text[])', [FIXTURE_NR_CODES]);

    redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(ASSISTANT_RATE_LIMIT_KEY);

    // POST /assistant/normative-query é @Roles('empresa','tecnico','parceiro')
    // — admin recebe 403, então o token aqui é de empresa.
    const tenant = await db.createTenantWithUser('Empresa Assistente Checklist Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const item = await client.query(
      `INSERT INTO sst_checklist_items
         (nr_code, nr_title, nr_category, document_name, description, legal_requirement, infraction_index, embedding)
       VALUES ('NR-ASSISTENTE-TESTE', 'Norma teste', 'geral', 'Documento teste checklist',
               'Descrição teste checklist', 'Item 9.9.9 de teste', 2, $1::vector)
       RETURNING id`,
      [exactVector],
    );
    checklistItemId = item.rows[0].id;

    // Segunda fixture, pros testes de integração com o Verificador v2
    // (checkClaimSupport): o content que chega lá é
    // "NR-98 — Documento verificador teste: Descrição de teste do verificador — Item 98.1.2 de teste".
    const verifierItem = await client.query(
      `INSERT INTO sst_checklist_items
         (nr_code, nr_title, nr_category, document_name, description, legal_requirement, infraction_index, embedding)
       VALUES ('NR-98', 'Norma teste verificador', 'geral', 'Documento verificador teste',
               'Descrição de teste do verificador', 'Item 98.1.2 de teste', 2, $1::vector)
       RETURNING id`,
      [exactVector],
    );
    verifierItemId = verifierItem.rows[0].id;
  });

  afterEach(async () => {
    fakeAnswer.mockReset();
    await redis.del(ASSISTANT_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM sst_checklist_items WHERE nr_code = ANY($1::text[])', [FIXTURE_NR_CODES]);
    await db.cleanup();
    await db.disconnect();
    await redis.quit();
    await app.close();
  });

  it('inclui checklist_ref_ids e checklist_citations quando o provider cita um item do checklist', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'Você precisa manter o Documento teste checklist.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [checklistItemId],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Quais documentos preciso ter?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('Documento teste checklist');
    expect(res.body.checklist_citations).toEqual([
      { item_id: checklistItemId, nr_code: 'NR-ASSISTENTE-TESTE', document_name: 'Documento teste checklist' },
    ]);

    const answerArgs = fakeAnswer.mock.calls[0];
    const checklistItemsArg = answerArgs[4];
    expect(checklistItemsArg.some((c: any) => c.id === checklistItemId)).toBe(true);

    // Trava a string exata do SQL de retrieval (normative-assistant.service.ts):
    // o texto que o modelo lê tem que ser o mesmo que gerou o vetor do item
    // (`${nr_code} — ${document_name}: ${description} — ${legal_requirement}`).
    const retrieved = checklistItemsArg.find((c: any) => c.id === checklistItemId);
    expect(retrieved.content).toBe(
      'NR-ASSISTENTE-TESTE — Documento teste checklist: Descrição teste checklist — Item 9.9.9 de teste',
    );
  });

  it('descarta o claim quando checklist_ref_ids aponta pra um id que não veio na busca', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'Afirmação com id inventado.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: ['00000000-0000-0000-0000-000000000000'],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Quais documentos preciso ter?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.checklist_citations).toEqual([]);
  });

  it('descarta a claim INTEIRA quando checklist_ref_ids mistura um id válido com um id inexistente', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'Você precisa manter o Documento teste checklist.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [checklistItemId, '00000000-0000-0000-0000-000000000000'],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Quais documentos preciso ter?' });

    expect(res.status).toBe(201);
    // Um id inválido invalida a claim inteira — a citação válida também cai.
    expect(res.body.answer).toBeNull();
    expect(res.body.checklist_citations).toEqual([]);
  });

  it('mantém a claim que cita NR e item presentes no texto do item de checklist citado (Verificador v2 soma o checklist à evidência)', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'A NR-98 exige o Documento verificador teste (item 98.1.2).',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [verifierItemId],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Quais documentos a NR-98 exige?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('NR-98');
    expect(res.body.checklist_citations).toEqual([
      { item_id: verifierItemId, nr_code: 'NR-98', document_name: 'Documento verificador teste' },
    ]);
  });

  it('descarta a claim que cita uma NR ausente do texto do item de checklist citado (Verificador v2)', async () => {
    fakeAnswer.mockResolvedValueOnce([
      {
        claim: 'A NR-97 exige o Documento verificador teste.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [verifierItemId],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'Quais documentos a NR-98 exige?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.checklist_citations).toEqual([]);
  });
});
