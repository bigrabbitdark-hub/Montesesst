import 'reflect-metadata';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthenticatedUser } from '../src/common/types';
import { DatabaseService } from '../src/common/database/database.service';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { detectNotices } from '../src/normative/question-notices';
import { EvalArgs, parseEvalArgs } from './args';
import { GoldenQuestion, parseGoldenDataset } from './golden/golden-schema';
import { planLlmRun } from './llm-plan';
import {
  AnswerObservation,
  AnswerResult,
  ComparableResult,
  RetrievalResult,
  evaluateAnswer,
  evaluateRetrieval,
  findRegressions,
} from './metrics';
import {
  BaselineMeta,
  buildAnswerBaseline,
  buildRetrievalBaseline,
  datasetHash,
  formatAnswerSummary,
  formatRetrievalSummary,
  renderReviewMarkdown,
  ReviewItem,
} from './report';

// Runner de avaliação do Assistente (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5).
// Sobe um contexto Nest SEM servidor HTTP e chama o mesmo
// NormativeAssistantService de produção.
//
//   eval:retrieval — Camada A: recuperação + avisos. Sem LLM de resposta (só o
//                    embedding da pergunta, centavos por rodada).
//   eval:answer    — Camada B: resposta real. Chama o LLM PAGO; exige --llm e
//                    tem teto (--max-llm-calls, padrão 15; --allow-full remove).
//
// Só LÊ o banco: queryWithTrace não grava nada (só query() grava no log de uso).
//
// Uso: ./run-backend-tests.sh eval:retrieval [-- --tipo pegadinha --out arquivo.json --compare base.json]
//      ./run-backend-tests.sh eval:answer -- --llm [--max-llm-calls 15 ...]
const DEFAULT_DATASET = join(__dirname, 'golden', 'perguntas.json');
// Usuário sintético, sem tenant: a avaliação mede só a base normativa.
const EVAL_USER: AuthenticatedUser = { id: '00000000-0000-0000-0000-000000000000', tenantId: null, role: 'tecnico' };

function selectQuestions(all: GoldenQuestion[], args: EvalArgs): GoldenQuestion[] {
  const selected = all.filter(
    (q) => (args.ids.length === 0 || args.ids.includes(q.id)) && (args.tipos.length === 0 || args.tipos.includes(q.tipo)),
  );
  if (selected.length === 0) throw new Error('Nenhuma pergunta selecionada pelos filtros --ids/--tipo');
  return selected;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'desconhecido';
  }
}

// DESVIO do brief: BaselineMeta (report.ts) exige o campo `model`, ausente no
// código literal do Step 1 — sem ele o typecheck falha (Property 'model' is
// missing). Corrigido no mínimo: omitido também do parâmetro `meta` e
// preenchido no objeto final, no mesmo padrão de `threshold`/`chunk_limit`
// (null na Camada A, que nunca chama o LLM de resposta).
async function runRetrieval(assistant: NormativeAssistantService, questions: GoldenQuestion[], meta: Omit<BaselineMeta, 'threshold' | 'chunk_limit' | 'model'>) {
  const results: RetrievalResult[] = [];
  let threshold = 0;
  let chunkLimit = 0;
  for (const [index, q] of questions.entries()) {
    const retrieval = await assistant.retrieve(q.pergunta);
    threshold = retrieval.threshold;
    chunkLimit = retrieval.chunkLimit;
    results.push(
      evaluateRetrieval(q, {
        chunks: retrieval.normativeRows.map((row) => ({
          chunk_id: row.chunk_id,
          source_code: row.source_code,
          content: row.content,
          similarity: row.similarity,
        })),
        threshold: retrieval.threshold,
        notices: detectNotices(q.pergunta).map((notice) => notice.tipo),
      }),
    );
    if ((index + 1) % 10 === 0) console.log(`  … ${index + 1}/${questions.length}`);
  }
  const baseline = buildRetrievalBaseline({ ...meta, threshold, chunk_limit: chunkLimit, model: null }, results);
  console.log(`\n${formatRetrievalSummary(baseline)}`);
  const falhas = results.filter((r) => !r.passou);
  if (falhas.length > 0) {
    console.log(`\nNão passaram (${falhas.length}): ${falhas.map((r) => r.id).join(', ')}`);
  }
  return { baseline, review: null };
}

async function fetchChunkContents(db: DatabaseService, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.withoutTenantContext((client) =>
    client.query<{ id: string; content: string }>(
      'SELECT id, content FROM normative_document_chunks WHERE id = ANY($1::uuid[])',
      [ids],
    ),
  );
  return new Map(rows.map((row) => [row.id, row.content]));
}

async function runAnswer(
  assistant: NormativeAssistantService,
  db: DatabaseService,
  questions: GoldenQuestion[],
  meta: Omit<BaselineMeta, 'threshold' | 'chunk_limit' | 'llm_calls' | 'llm_tokens_delta' | 'model'>,
) {
  const startedAt = (await db.withoutTenantContext((client) => client.query<{ now: Date }>('SELECT now() AS now'))).rows[0].now;
  const results: AnswerResult[] = [];
  const review: ReviewItem[] = [];
  let threshold = 0;
  let chunkLimit = 0;
  let model: string | null = null;
  for (const [index, q] of questions.entries()) {
    const { result, trace } = await assistant.queryWithTrace(q.pergunta, EVAL_USER);
    threshold = trace.threshold;
    chunkLimit = trace.chunk_limit;
    model = trace.model;
    const contents = await fetchChunkContents(db, trace.normative.map((c) => c.chunk_id));
    const observation: AnswerObservation = {
      answer: result.answer,
      notices: trace.notices,
      retrieved: trace.normative.map((c) => ({
        chunk_id: c.chunk_id,
        source_code: c.source_code,
        content: contents.get(c.chunk_id) ?? '',
        similarity: c.similarity,
      })),
      kept_claims_chunk_ids: trace.kept_claims.map((claim) => claim.chunk_ids),
      claims_dropped_support: trace.claims_dropped_support,
      flagged_numbers: trace.flagged_numbers,
    };
    const evaluated = evaluateAnswer(q, observation);
    results.push(evaluated);
    review.push({
      id: q.id,
      tipo: q.tipo,
      pergunta: q.pergunta,
      resposta_esperada: q.resposta_esperada,
      answer: result.answer,
      notices: trace.notices,
      citations: result.citations.map((citation) => citation.title),
      passou: evaluated.passou,
    });
    console.log(`  ${index + 1}/${questions.length} ${q.id}: ${evaluated.passou ? 'passou' : 'NÃO passou'}`);
  }
  const tokens = (
    await db.withoutTenantContext((client) =>
      client.query<{ tokens: number }>(
        `SELECT COALESCE(SUM(total_tokens), 0)::int AS tokens FROM minimax_usage_log
         WHERE capability = 'assistant_normative_query' AND created_at >= $1`,
        [startedAt],
      ),
    )
  ).rows[0].tokens;
  const baseline = buildAnswerBaseline(
    { ...meta, threshold, chunk_limit: chunkLimit, model, llm_calls: questions.length, llm_tokens_delta: tokens },
    results,
  );
  console.log(`\n${formatAnswerSummary(baseline)}`);
  console.log('\n(o gasto em tokens soma o de qualquer uso real que tenha ocorrido no mesmo intervalo)');
  return { baseline, review };
}

async function main() {
  const [layer, ...rest] = process.argv.slice(2);
  if (layer !== 'retrieval' && layer !== 'answer') {
    console.error('Uso: run-eval.ts <retrieval|answer> [flags]');
    process.exit(1);
  }
  const args = parseEvalArgs(rest);

  const datasetJson = readFileSync(args.file ?? DEFAULT_DATASET, 'utf8');
  const dataset = parseGoldenDataset(JSON.parse(datasetJson));
  const selected = selectQuestions(dataset, args);

  let questions = selected;
  if (layer === 'answer') {
    const plan = planLlmRun(args, selected); // exige --llm; aplica o teto
    questions = plan.questions;
    console.log(
      `Camada B: ${questions.length} de ${selected.length} perguntas, ~${plan.estimatedTokens} tokens estimados ` +
        `(chamadas REAIS e PAGAS ao LLM configurado)`,
    );
  } else {
    console.log(`Camada A: ${questions.length} pergunta(s) — só embedding, sem LLM de resposta`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let exitCode = 0;
  try {
    const assistant = app.get(NormativeAssistantService);
    const meta = {
      layer,
      gerado_em: new Date().toISOString(),
      commit: gitCommit(),
      dataset_sha256: datasetHash(datasetJson),
      questions: questions.length,
      llm_calls: null,
      llm_tokens_delta: null,
    } as const;

    const { baseline, review } =
      layer === 'retrieval'
        ? await runRetrieval(assistant, questions, meta)
        : await runAnswer(assistant, app.get(DatabaseService), questions, meta);

    if (args.out) {
      writeFileSync(args.out, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`\nBaseline gravado em ${args.out}`);
      if (review) {
        const markdownPath = args.out.replace(/\.json$/, '') + '.md';
        writeFileSync(markdownPath, `${renderReviewMarkdown(review)}\n`);
        console.log(`Revisão lado a lado (para o validador) gravada em ${markdownPath}`);
      }
    }

    if (args.compare) {
      const previous = JSON.parse(readFileSync(args.compare, 'utf8'));
      if (previous.meta?.layer !== layer) {
        throw new Error(`--compare aponta para um baseline da camada "${previous.meta?.layer}", esta rodada é "${layer}"`);
      }
      const regressions = findRegressions(
        previous.resultados as ComparableResult[],
        baseline.resultados as ComparableResult[],
      );
      if (regressions.length === 0) {
        console.log('\nGate: nenhuma regressão entre as perguntas validadas.');
      } else {
        console.log(`\nGate: ${regressions.length} regressão(ões) entre as perguntas validadas:`);
        for (const regression of regressions) console.log(`  - ${regression.id}: ${regression.motivo}`);
        // Camada A é determinística: reprova. Camada B oscila com o LLM: só reprova se pedido.
        if (layer === 'retrieval' || args.failOnRegression) exitCode = 1;
      }
    }
  } finally {
    await app.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[eval] falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
