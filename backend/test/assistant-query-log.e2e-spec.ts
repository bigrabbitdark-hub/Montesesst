import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/database/database.service';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { AssistantQueryLogService } from '../src/normative/assistant-query-log.service';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { hashQuestion } from '../src/normative/query-trace';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { AuthenticatedUser } from '../src/common/types';
import { TestDb } from './db-test-helper';

const CHUNK_TEXT = '98.1.1 Trecho oficial de teste do log de uso sobre uso de luvas de proteção.';

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

describe('assistant_query_log — log de uso real do Assistente (e2e)', () => {
  // test/jest-e2e-setup.ts liga o interruptor em todo e2e; só este arquivo o
  // desliga, porque é o que testa a gravação de verdade.
  const previousFlag = process.env.ASSISTANT_QUERY_LOG_DISABLED;

  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: TestDb;
  let database: DatabaseService;
  let assistant: NormativeAssistantService;
  let logService: AssistantQueryLogService;
  let empresa: AuthenticatedUser;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  let expiredDocumentId: string;
  const hashesToClean: string[] = [];

  const exactVector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const fakeAnswer = jest.fn();
  const fakeEmbed = jest.fn();

  function uniqueQuestion(prefix = 'Pergunta única do log'): string {
    const question = `${prefix} ${randomUUID()}`;
    hashesToClean.push(hashQuestion(question));
    return question;
  }

  async function rowsByHash(hash: string): Promise<any[]> {
    const result = await (db as any).client.query('SELECT * FROM assistant_query_log WHERE question_hash = $1', [hash]);
    return result.rows;
  }

  // O log é gravado sem ninguém esperar (o query() não aguarda): espera a linha aparecer.
  async function waitForRows(hash: string, expected = 1, timeoutMs = 4000): Promise<any[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await rowsByHash(hash);
      if (rows.length >= expected || Date.now() > deadline) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assistant = moduleRef.get(NormativeAssistantService);
    logService = moduleRef.get(AssistantQueryLogService);
    database = moduleRef.get(DatabaseService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const tenant = await db.createTenantWithUser('Empresa Log Uso Teste');
    empresa = { id: tenant.userId, tenantId: tenant.tenantId, role: 'empresa' };

    const expired = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'Documento vencido teste do log', $2, $2, 'application/pdf', 100, (now() - interval '5 days')::date, $3, 'empresa')
       RETURNING id`,
      [tenant.tenantId, `fixture/${tenant.tenantId}-log.pdf`, tenant.userId],
    );
    expiredDocumentId = expired.rows[0].id;

    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-LOGUSO', 'Norma teste do log de uso', 'https://exemplo.gov.br/loguso.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-loguso', 'normative/loguso.html', 'loguso.html', 'text/html', 'Texto vigente do log', now())
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
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM assistant_query_log WHERE question_hash = ANY($1)', [hashesToClean]);
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
    if (previousFlag === undefined) delete process.env.ASSISTANT_QUERY_LOG_DISABLED;
    else process.env.ASSISTANT_QUERY_LOG_DISABLED = previousFlag;
  });

  it('uma pergunta grava exatamente 1 linha e nenhuma coluna contém o texto da pergunta nem da resposta', async () => {
    const question = uniqueQuestion();
    const answerText = 'É obrigatório o uso de luvas de proteção.';
    fakeAnswer.mockResolvedValue([claim(answerText, { chunk_ids: [chunkId] })]);

    const result = await assistant.query(question, empresa);
    expect(result.answer).toBe(answerText);

    const hash = hashQuestion(question);
    const rows = await waitForRows(hash);
    expect(rows).toHaveLength(1);
    // Nenhuma linha duplicada aparece depois.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await rowsByHash(hash)).toHaveLength(1);

    const row = rows[0];
    expect(row).toMatchObject({
      role: 'empresa',
      tenant_id: null,
      outcome: 'respondeu',
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 0,
      used_attachment: false,
    });
    expect(row.retrieved.normative.find((c: any) => c.chunk_id === chunkId)).toMatchObject({
      source_code: 'NR-LOGUSO',
      passed_threshold: true,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(question);
    expect(serialized).not.toContain('luvas de proteção');
  });

  it('grava os tipos de aviso disparados pela pergunta', async () => {
    const question = uniqueQuestion('Quais as regras de PPCI?');
    fakeAnswer.mockResolvedValue([]);

    await assistant.query(question, empresa);

    const rows = await waitForRows(hashQuestion(question));
    expect(rows).toHaveLength(1);
    expect(rows[0].notices).toEqual(['jurisdicao']);
  });

  it('privacidade dos tokens: só grava item/NR inventado quando a claim cita apenas trecho normativo', async () => {
    const apenasNormativo = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('Conforme o item 99.9.9, a luva é obrigatória.', { chunk_ids: [chunkId] })]);
    await assistant.query(apenasNormativo, empresa);

    const comEmpresa = uniqueQuestion();
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9 e a sua pendência.', { chunk_ids: [chunkId], operational_ref_ids: ['op-0'] }),
    ]);
    await assistant.query(comEmpresa, empresa, undefined, empresa.tenantId ?? undefined);

    const [rowNormativo] = await waitForRows(hashQuestion(apenasNormativo));
    expect(rowNormativo.claims_dropped_support).toBe(1);
    expect(rowNormativo.blocking_tokens).toEqual(['item 99.9.9']);

    const [rowEmpresa] = await waitForRows(hashQuestion(comEmpresa));
    expect(rowEmpresa.tenant_id).toBe(empresa.tenantId);
    expect(rowEmpresa.claims_dropped_support).toBe(1);
    expect(rowEmpresa.blocking_tokens).toEqual([]);
    expect(rowEmpresa.retrieved.operational_count).toBeGreaterThan(0);
  });

  it('o interruptor ASSISTANT_QUERY_LOG_DISABLED impede a gravação', async () => {
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true';
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);

    await assistant.query(question, empresa);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await rowsByHash(hashQuestion(question))).toHaveLength(0);
  });

  it('falha na gravação nunca derruba: record() resolve mesmo com uma linha inválida, e nada é gravado', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true'; // este queryWithTrace não deve gravar por conta própria
    const { trace } = await assistant.queryWithTrace(question, empresa);
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';

    await expect(logService.record({ ...trace, outcome: 'invalido' as any })).resolves.toBeUndefined();

    expect(await rowsByHash(trace.question_hash)).toHaveLength(0);
  });

  it('RLS: a empresa não lê o log, o admin lê', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);
    await assistant.query(question, empresa);
    const hash = hashQuestion(question);
    await waitForRows(hash);

    const asEmpresa = await database.withTenantContext(
      { role: 'empresa', tenantId: empresa.tenantId ?? undefined, userId: empresa.id },
      (client) => client.query('SELECT count(*)::int AS n FROM assistant_query_log WHERE question_hash = $1', [hash]),
    );
    expect(asEmpresa.rows[0].n).toBe(0);

    const asAdmin = await database.withTenantContext({ role: 'admin' }, (client) =>
      client.query('SELECT count(*)::int AS n FROM assistant_query_log WHERE question_hash = $1', [hash]),
    );
    expect(asAdmin.rows[0].n).toBe(1);
  });

  it('retenção: purgeOlderThan(90) apaga a linha antiga e preserva a recente', async () => {
    const oldHash = `purge-antiga-${randomUUID()}`;
    const recentHash = `purge-recente-${randomUUID()}`;
    hashesToClean.push(oldHash, recentHash);
    const insert = `INSERT INTO assistant_query_log
      (created_at, role, question_hash, outcome, retrieved, claims_total, claims_dropped_ids, claims_dropped_support, latency_ms, retrieval_ms)
      VALUES (now() - ($2 || ' days')::interval, 'empresa', $1, 'respondeu', '{}'::jsonb, 0, 0, 0, 1, 1)`;
    await (db as any).client.query(insert, [oldHash, '100']);
    await (db as any).client.query(insert, [recentHash, '10']);

    const deleted = await logService.purgeOlderThan(90);

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await rowsByHash(oldHash)).toHaveLength(0);
    expect(await rowsByHash(recentHash)).toHaveLength(1);
  });
});
