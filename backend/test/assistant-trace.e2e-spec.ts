import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { hashQuestion } from '../src/normative/query-trace';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { AuthenticatedUser } from '../src/common/types';
import { TestDb } from './db-test-helper';

const CHUNK_TEXT = '99.1.1 Trecho oficial de teste do trace sobre uso de protetor auricular.';

function claim(text: string, overrides: Record<string, unknown> = {}) {
  return {
    claim: text,
    chunk_ids: [] as string[],
    operational_ref_ids: [] as string[],
    company_chunk_ids: [] as string[],
    checklist_ref_ids: [] as string[],
    uses_attachment: false,
    ...overrides,
  };
}

describe('Assistente — trace da pergunta e recuperação de referência (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: TestDb;
  let assistant: NormativeAssistantService;
  let empresa: AuthenticatedUser;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  let expiredDocumentId: string;

  const exactVector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const orthogonalVector = new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0));
  const fakeAnswer = jest.fn();
  const fakeEmbed = jest.fn();

  // Pergunta única por teste, sem nenhum gatilho de aviso.
  const uniqueQuestion = () => `Pergunta única do trace ${randomUUID()}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assistant = moduleRef.get(NormativeAssistantService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const tenant = await db.createTenantWithUser('Empresa Trace Teste');
    empresa = { id: tenant.userId, tenantId: tenant.tenantId, role: 'empresa' };

    // Documento vencido: gera um item operacional ("op-0") pra este tenant.
    const expired = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'Documento vencido teste do trace', $2, $2, 'application/pdf', 100, (now() - interval '5 days')::date, $3, 'empresa')
       RETURNING id`,
      [tenant.tenantId, `fixture/${tenant.tenantId}-trace.pdf`, tenant.userId],
    );
    expiredDocumentId = expired.rows[0].id;

    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-TRACE', 'Norma teste do trace', 'https://exemplo.gov.br/trace.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-trace', 'normative/trace.html', 'trace.html', 'text/html', 'Texto vigente do trace', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, $2, $3::vector) RETURNING id`,
      [documentId, CHUNK_TEXT, toVectorLiteral(exactVector)],
    );
    chunkId = chunk.rows[0].id;
  });

  beforeEach(() => {
    fakeEmbed.mockResolvedValue(exactVector);
  });

  afterEach(() => {
    fakeAnswer.mockReset();
    fakeEmbed.mockReset();
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('query() devolve exatamente o mesmo resultado que queryWithTrace()', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de protetor auricular.', { chunk_ids: [chunkId] })]);

    const direct = await assistant.query(question, empresa);
    const traced = await assistant.queryWithTrace(question, empresa);

    expect(direct).toEqual(traced.result);
    expect(direct.answer).toBe('É obrigatório o uso de protetor auricular.');
  });

  it('o trace registra a recuperação e o verificador, sem nenhum texto de pergunta ou de claim', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de protetor auricular.', { chunk_ids: [chunkId] })]);

    const { trace } = await assistant.queryWithTrace(question, empresa);

    const candidate = trace.normative.find((c) => c.chunk_id === chunkId);
    expect(candidate).toMatchObject({ document_id: documentId, source_code: 'NR-TRACE', passed_threshold: true });
    expect(candidate!.similarity).toBeGreaterThan(0.99);
    expect(trace.threshold).toBeGreaterThan(0);
    expect(trace.chunk_limit).toBe(6);
    expect(trace).toMatchObject({
      outcome: 'respondeu',
      role: 'empresa',
      tenant_id: null,
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 0,
      notices: [],
      used_attachment: false,
      model: null,
    });
    expect(trace.kept_claims).toEqual([{ chunk_ids: [chunkId] }]);
    expect(trace.question_hash).toBe(hashQuestion(question));
    expect(trace.retrieval_ms).toBeGreaterThanOrEqual(0);
    expect(trace.latency_ms).toBeGreaterThanOrEqual(trace.retrieval_ms);

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain(question);
    expect(serialized).not.toContain('protetor auricular');
  });

  it('sem trecho relevante: fallback_sem_evidencia, candidatos abaixo do limiar e provedor não chamado', async () => {
    fakeEmbed.mockResolvedValue(orthogonalVector);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBeNull();
    expect(trace.outcome).toBe('fallback_sem_evidencia');
    expect(trace.normative.length).toBeGreaterThan(0);
    expect(trace.normative.every((c) => !c.passed_threshold)).toBe(true);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('claim com item inventado é descartada e o token fica registrado (só citava trecho normativo)', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9, o protetor é obrigatório.', { chunk_ids: [chunkId] }),
    ]);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBeNull();
    expect(trace).toMatchObject({
      outcome: 'fallback_claims_descartadas',
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 1,
      blocking_tokens: ['item 99.9.9'],
      kept_claims: [],
    });
  });

  it('claim com id inexistente é contada como descartada pelo id-check', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Afirmação com fonte inventada.', { chunk_ids: ['00000000-0000-0000-0000-000000000000'] }),
    ]);

    const { trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(trace).toMatchObject({
      outcome: 'fallback_claims_descartadas',
      claims_dropped_ids: 1,
      claims_dropped_support: 0,
    });
  });

  it('número com unidade sem base só é registrado: a claim sobrevive e o token vai para flagged_numbers', async () => {
    fakeAnswer.mockResolvedValue([
      claim('O protetor deve ser trocado a cada 8 horas de uso.', { chunk_ids: [chunkId] }),
    ]);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBe('O protetor deve ser trocado a cada 8 horas de uso.');
    expect(trace.outcome).toBe('respondeu');
    expect(trace.flagged_numbers).toEqual(['8 horas']);
    expect(trace.blocking_tokens).toEqual([]);
  });

  it('privacidade: claim que também cita item operacional da empresa não grava os tokens, só a contagem', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9 e a sua pendência.', { chunk_ids: [chunkId], operational_ref_ids: ['op-0'] }),
    ]);

    const { trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa, undefined, empresa.tenantId ?? undefined);

    expect(trace.tenant_id).toBe(empresa.tenantId);
    expect(trace.operational_count).toBeGreaterThan(0);
    expect(trace.claims_dropped_support).toBe(1);
    expect(trace.blocking_tokens).toEqual([]);
    expect(trace.flagged_numbers).toEqual([]);
  });

  it('retrieve() faz só a busca de referência: sem LLM, devolvendo limiar, limite e candidatos', async () => {
    const retrieval = await assistant.retrieve(uniqueQuestion());

    expect(fakeAnswer).not.toHaveBeenCalled();
    expect(retrieval.chunkLimit).toBe(6);
    expect(retrieval.threshold).toBeGreaterThan(0);
    const row = retrieval.normativeRows.find((r) => r.chunk_id === chunkId);
    expect(row?.source_code).toBe('NR-TRACE');
    expect(row?.similarity).toBeGreaterThan(0.99);

    const limited = await assistant.retrieve(uniqueQuestion(), 2);
    expect(limited.chunkLimit).toBe(2);
    expect(limited.normativeRows.length).toBeLessThanOrEqual(2);
  });
});
