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

describe('POST /assistant/normative-query — tenant_id de técnico/parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let documentId: string;
  let chunkId: string;
  let linkedTecnicoToken: string;
  let unlinkedTecnicoToken: string;
  let expiredDocumentId: string;
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

    const client = (db as any).client;
    const tenant = await db.createTenantWithUser('Empresa Assistente Tecnico Tenant Teste');
    tenantId = tenant.tenantId;

    const doc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Assistente Tecnico Teste', 'fixture/pgr-tecnico.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, tenant.userId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
       VALUES ($1, $2, 'pgr', 0, 'Trecho do PGR sobre risco de queda de altura.', $3::vector)
       RETURNING id`,
      [tenantId, documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;

    // Documento vencido do MESMO tenant — vira um item operacional real
    // (tipo:'documento', AI-safe pela allowlist ATTENTION_TIPO_AI_SAFE)
    // em dashboard.getSummary(). Existe só para o teste abaixo provar que
    // técnico vinculado NÃO recebe isto (Restrição Global §1 da Fase 10)
    // com uma pendência de verdade disponível — sem um item real, o
    // teste passaria mesmo se o guard de role fosse removido por engano,
    // porque não haveria nada a vazar.
    const expiredDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role, expires_at)
       VALUES ($1, 'pcmso', 'PCMSO Vencido Assistente Tecnico Teste', 'fixture/pcmso-vencido.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa', now() - interval '10 days')
       RETURNING id`,
      [tenantId, tenant.userId],
    );
    expiredDocumentId = expiredDoc.rows[0].id;

    // Mesmo padrão de fixture de pente-fino-run.e2e-spec.ts: dois
    // técnicos com o mesmo cenário do ponto de vista do atacante, só o
    // vínculo em tenant_technicians diferindo.
    const linkedUser = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Assistente Teste');
    const unlinkedUser = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Assistente Teste');

    const linkedTech = await client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [
      linkedUser.userId,
    ]);
    await client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      tenantId,
      linkedTech.rows[0].id,
    ]);
    await client.query('INSERT INTO technicians (user_id) VALUES ($1)', [unlinkedUser.userId]);

    const linkedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: linkedUser.email, password: linkedUser.password });
    linkedTecnicoToken = linkedLogin.body.access_token;

    const unlinkedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedUser.email, password: unlinkedUser.password });
    unlinkedTecnicoToken = unlinkedLogin.body.access_token;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_document_chunks WHERE id = $1', [chunkId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('tecnico vinculado + tenant_id: recebe company_citations da empresa', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'O PGR identifica risco de queda de altura.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [chunkId],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${linkedTecnicoToken}`)
      .send({ question: 'o que o PGR diz sobre altura?', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('queda de altura');
    expect(res.body.company_citations).toEqual([
      { document_id: documentId, title: 'PGR Assistente Tecnico Teste', category: 'pgr' },
    ]);
  });

  it('tecnico vinculado + tenant_id: NUNCA recebe itens operacionais, mesmo com pendência real disponível (Restrição Global §1 da Fase 10)', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'O PGR identifica risco de queda de altura.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [chunkId],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${linkedTecnicoToken}`)
      .send({ question: 'o que o PGR diz sobre altura?', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(fakeAnswer).toHaveBeenCalledTimes(1);
    // Índice 2 é `operationalItems` na assinatura de
    // NormativeAnswerProvider.answer(question, chunks, operationalItems,
    // companyChunks, checklistItems, attachment) — precisa vir [], nunca
    // o "PCMSO Vencido" que existe de verdade pra este tenant (empresa
    // veria; técnico não pode).
    expect(fakeAnswer.mock.calls[0][2]).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('PCMSO Vencido');
  });

  it('tecnico NÃO vinculado + tenant_id real: 403, sem vazar nenhum dado da empresa', async () => {
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${unlinkedTecnicoToken}`)
      .send({ question: 'o que o PGR diz sobre altura?', tenant_id: tenantId });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('PGR Assistente Tecnico Teste');
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('tecnico SEM tenant_id: continua puramente normativo, sem dado operacional/documento (regressão)', async () => {
    // `fakeEmbed` sempre devolve o mesmo vetor fixo, que não bate com
    // nenhum chunk normativo real indexado (são embeddings reais de
    // normas de verdade) — sem tenant_id, os três conjuntos (normativo,
    // operacional, documento da empresa) ficam vazios, e a rota nem
    // chega a chamar `answerer.answer` (cai no fallback antes). Isso é
    // o comportamento correto sendo exercitado, não um teste que não
    // testa nada: se `operationalItems`/`companyChunks` deixassem de
    // ficar vazios (o bug que esta regressão previne), a IA chegaria a
    // ser chamada com itens reais, e o fallback abaixo não bateria.
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${linkedTecnicoToken}`)
      .send({ question: 'pergunta sem relação com nenhum trecho indexado' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBeDefined();
    expect(res.body.answer).toBeNull();
    expect(res.body.company_citations).toEqual([]);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });
});
