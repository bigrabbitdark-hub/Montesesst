// Montagem e resumo dos baselines do runner de avaliação (Etapas 2 e 3 da
// Confiabilidade do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5.4).
// Módulo puro: sem I/O.
import { createHash } from 'crypto';
import { AVISOS, TIPOS } from './golden/golden-schema';
import {
  AnswerAggregate,
  AnswerResult,
  RetrievalAggregate,
  RetrievalResult,
  aggregateAnswer,
  aggregateNotices,
  aggregateRetrieval,
  groupBy,
} from './metrics';

export interface BaselineMeta {
  layer: 'retrieval' | 'answer';
  gerado_em: string;
  commit: string;
  dataset_sha256: string;
  questions: number;
  threshold: number | null;
  chunk_limit: number | null;
  llm_calls: number | null;
  llm_tokens_delta: number | null;
}

export interface BaselineFile<Result, Aggregate> {
  meta: BaselineMeta;
  resultados: Result[];
  agregados: {
    geral: Aggregate;
    validado: Aggregate;
    rascunho: Aggregate;
    por_tipo: Record<string, Aggregate>;
  };
}

export function datasetHash(datasetJson: string): string {
  return createHash('sha256').update(datasetJson).digest('hex');
}

function build<Result extends { tipo: string; status: string }, Aggregate>(
  meta: BaselineMeta,
  results: Result[],
  aggregate: (subset: Result[]) => Aggregate,
): BaselineFile<Result, Aggregate> {
  const porTipo = groupBy(results, (r) => r.tipo);
  return {
    meta,
    resultados: results,
    agregados: {
      geral: aggregate(results),
      validado: aggregate(results.filter((r) => r.status === 'validado')),
      rascunho: aggregate(results.filter((r) => r.status === 'rascunho')),
      por_tipo: Object.fromEntries(TIPOS.filter((tipo) => porTipo[tipo]).map((tipo) => [tipo, aggregate(porTipo[tipo])])),
    },
  };
}

export function buildRetrievalBaseline(
  meta: BaselineMeta,
  results: RetrievalResult[],
): BaselineFile<RetrievalResult, RetrievalAggregate> {
  return build(meta, results, aggregateRetrieval);
}

export function buildAnswerBaseline(
  meta: BaselineMeta,
  results: AnswerResult[],
): BaselineFile<AnswerResult, AnswerAggregate> {
  return build(meta, results, aggregateAnswer);
}

// "numerador/denominador (xx%)" — ou "—" no percentual quando não há denominador.
export function ratio(n: number, d: number): string {
  return d === 0 ? `${n}/${d} (—)` : `${n}/${d} (${Math.round((n / d) * 100)}%)`;
}

function retrievalLine(label: string, a: RetrievalAggregate): string {
  return (
    `${label.padEnd(24)} passou ${ratio(a.passou, a.total).padEnd(12)}` +
    ` acerto NR ${ratio(a.acerto_nr, a.com_fontes).padEnd(12)}` +
    ` acerto item ${ratio(a.acerto_item, a.com_fontes).padEnd(12)}` +
    ` (topk ${ratio(a.acerto_item_topk, a.com_fontes)})` +
    ` falso relevante ${ratio(a.falso_relevante, a.recusa_total)}` +
    ` avisos ok ${ratio(a.avisos_ok, a.total)}`
  );
}

function answerLine(label: string, a: AnswerAggregate): string {
  return (
    `${label.padEnd(24)} passou ${ratio(a.passou, a.total).padEnd(12)}` +
    ` responderam ${ratio(a.responderam, a.total).padEnd(12)}` +
    ` citaram item ${ratio(a.citaram_item, a.com_fontes).padEnd(12)}` +
    ` claims descartadas ${a.claims_descartadas_por_suporte}` +
    ` números sinalizados ${a.numeros_sinalizados}`
  );
}

// Precisão/recall do detector de avisos: null (sem denominador) vira "n/d".
function fmtRate(value: number | null): string {
  return value === null ? 'n/d' : value.toFixed(2);
}

// Uma linha com precisão e recall de cada tipo de aviso (spec §5.2), calculada
// dos resultados por pergunta que o próprio baseline já guarda.
function noticesLine(results: RetrievalResult[]): string {
  const stats = aggregateNotices(results);
  const parts = AVISOS.map((tipo) => {
    const s = stats[tipo];
    return `${tipo} P ${fmtRate(s.precisao)} R ${fmtRate(s.recall)} (tp ${s.tp}, fp ${s.fp}, fn ${s.fn})`;
  });
  return `  avisos por tipo: ${parts.join(' · ')}`;
}

export function formatRetrievalSummary(baseline: BaselineFile<RetrievalResult, RetrievalAggregate>): string {
  const { agregados } = baseline;
  const lines = [
    `Camada A — recuperação e avisos (${baseline.meta.questions} perguntas, limiar ${baseline.meta.threshold}, top ${baseline.meta.chunk_limit})`,
    retrievalLine('GERAL', agregados.geral),
    retrievalLine('  validado (gate)', agregados.validado),
    retrievalLine('  rascunho', agregados.rascunho),
    ...Object.entries(agregados.por_tipo).map(([tipo, a]) => retrievalLine(`  ${tipo}`, a)),
    noticesLine(baseline.resultados),
  ];
  return lines.join('\n');
}

export function formatAnswerSummary(baseline: BaselineFile<AnswerResult, AnswerAggregate>): string {
  const { agregados, meta } = baseline;
  const lines = [
    `Camada B — resposta real (${meta.questions} perguntas, ${meta.llm_calls ?? 0} chamadas ao LLM, tokens ${meta.llm_tokens_delta ?? 'n/d'})`,
    answerLine('GERAL', agregados.geral),
    answerLine('  validado (gate)', agregados.validado),
    answerLine('  rascunho', agregados.rascunho),
    ...Object.entries(agregados.por_tipo).map(([tipo, a]) => answerLine(`  ${tipo}`, a)),
  ];
  return lines.join('\n');
}

export interface ReviewItem {
  id: string;
  tipo: string;
  pergunta: string;
  resposta_esperada: string;
  // null = o Assistente recusou (fallback).
  answer: string | null;
  notices: string[];
  citations: string[];
  passou: boolean;
}

// Markdown lado a lado para o profissional de SST validar as perguntas: a
// métrica não julga a semântica da prosa, então quem revisa vê a resposta
// esperada e a obtida juntas (spec §5.3).
export function renderReviewMarkdown(items: ReviewItem[]): string {
  const blocks = items.map((item) =>
    [
      `### ${item.id} — ${item.tipo} — ${item.passou ? 'passou' : 'NÃO passou'}`,
      '',
      `**Pergunta:** ${item.pergunta}`,
      '',
      `**Resposta esperada:** ${item.resposta_esperada}`,
      '',
      `**Resposta obtida:** ${item.answer ?? '_(o Assistente recusou: sem resposta)_'}`,
      '',
      `**Avisos:** ${item.notices.length > 0 ? item.notices.join(', ') : '—'}`,
      '',
      `**Fontes citadas:** ${item.citations.length > 0 ? item.citations.join('; ') : '—'}`,
      '',
      'Revisão: [ ] resposta correta  [ ] incompleta  [ ] errada — Observações:',
      '',
    ].join('\n'),
  );
  return `# Revisão lado a lado — Camada B\n\n${blocks.join('\n')}`;
}
