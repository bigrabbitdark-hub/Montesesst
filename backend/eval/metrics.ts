// Métricas do runner de avaliação (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5).
// Módulo puro: recebe observações já coletadas do pipeline e devolve
// resultados — sem I/O, sem NestJS, sem LLM.
import { AvisoTipo, Comportamento, FonteEsperada, GoldenQuestion, Status, Tipo } from './golden/golden-schema';
import { chunkContainsItemHeading } from './golden/quote';

export interface RetrievedChunkObs {
  chunk_id: string;
  source_code: string | null;
  content: string;
  similarity: number;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function isSubset(expected: readonly string[], detected: readonly string[]): boolean {
  return expected.every((value) => detected.includes(value));
}

function chunkMatchesFonte(chunk: RetrievedChunkObs, fonte: FonteEsperada): boolean {
  return chunk.source_code === fonte.source_code && chunkContainsItemHeading(chunk.content, fonte.item);
}

function anyItemHit(chunks: RetrievedChunkObs[], fontes: FonteEsperada[]): boolean {
  return chunks.some((chunk) => fontes.some((fonte) => chunkMatchesFonte(chunk, fonte)));
}

function anyNrHit(chunks: RetrievedChunkObs[], fontes: FonteEsperada[]): boolean {
  return chunks.some((chunk) => fontes.some((fonte) => chunk.source_code === fonte.source_code));
}

// ---------------------------------------------------------------------
// Camada A — recuperação e avisos (sem LLM de resposta)
// ---------------------------------------------------------------------

export interface RetrievalObservation {
  // Os candidatos do topo (chunk_limit), INCLUSIVE os abaixo do limiar.
  chunks: RetrievedChunkObs[];
  threshold: number;
  notices: AvisoTipo[];
}

export interface RetrievalResult {
  id: string;
  tipo: Tipo;
  status: Status;
  // null = não se aplica (pergunta sem fonte esperada). Os acertos "com
  // limiar" consideram só o que chegaria ao LLM (similaridade >= limiar);
  // `acerto_item_topk` ignora o limiar e diagnostica se a falha é da busca
  // ou do corte.
  acerto_nr: boolean | null;
  acerto_item: boolean | null;
  acerto_item_topk: boolean | null;
  melhor_similaridade: number | null;
  falso_relevante: boolean | null;
  avisos_esperados: AvisoTipo[];
  avisos_detectados: AvisoTipo[];
  avisos_ok: boolean;
  passou: boolean;
}

export function evaluateRetrieval(q: GoldenQuestion, obs: RetrievalObservation): RetrievalResult {
  const passed = obs.chunks.filter((chunk) => chunk.similarity >= obs.threshold);
  const temFontes = q.fontes_esperadas.length > 0;
  const melhor = obs.chunks.length > 0 ? Math.max(...obs.chunks.map((chunk) => chunk.similarity)) : null;

  const acertoNr = temFontes ? anyNrHit(passed, q.fontes_esperadas) : null;
  const acertoItem = temFontes ? anyItemHit(passed, q.fontes_esperadas) : null;
  const acertoItemTopk = temFontes ? anyItemHit(obs.chunks, q.fontes_esperadas) : null;

  const falsoRelevante =
    q.comportamento_esperado === 'recusar_sem_evidencia' ? melhor !== null && melhor >= obs.threshold : null;

  const avisosOk = sameSet(q.avisos_esperados, obs.notices);

  return {
    id: q.id,
    tipo: q.tipo,
    status: q.status,
    acerto_nr: acertoNr,
    acerto_item: acertoItem,
    acerto_item_topk: acertoItemTopk,
    melhor_similaridade: melhor,
    falso_relevante: falsoRelevante,
    avisos_esperados: q.avisos_esperados,
    avisos_detectados: obs.notices,
    avisos_ok: avisosOk,
    passou: (!temFontes || acertoItem === true) && avisosOk && falsoRelevante !== true,
  };
}

export interface RetrievalAggregate {
  total: number;
  passou: number;
  com_fontes: number;
  acerto_nr: number;
  acerto_item: number;
  acerto_item_topk: number;
  recusa_total: number;
  falso_relevante: number;
  avisos_ok: number;
}

export function aggregateRetrieval(results: RetrievalResult[]): RetrievalAggregate {
  const comFontes = results.filter((r) => r.acerto_item !== null);
  const recusas = results.filter((r) => r.falso_relevante !== null);
  return {
    total: results.length,
    passou: results.filter((r) => r.passou).length,
    com_fontes: comFontes.length,
    acerto_nr: comFontes.filter((r) => r.acerto_nr === true).length,
    acerto_item: comFontes.filter((r) => r.acerto_item === true).length,
    acerto_item_topk: comFontes.filter((r) => r.acerto_item_topk === true).length,
    recusa_total: recusas.length,
    falso_relevante: recusas.filter((r) => r.falso_relevante === true).length,
    avisos_ok: results.filter((r) => r.avisos_ok).length,
  };
}

// ---------------------------------------------------------------------
// Camada B — resposta real (LLM, só com --llm)
// ---------------------------------------------------------------------

export interface AnswerObservation {
  answer: string | null;
  notices: AvisoTipo[];
  // Trechos normativos recuperados (com o conteúdo, para achar o item).
  retrieved: RetrievedChunkObs[];
  // Ids de trecho citados por cada claim que SOBREVIVEU ao verificador.
  kept_claims_chunk_ids: string[][];
  claims_dropped_support: number;
  flagged_numbers: string[];
}

export interface AnswerResult {
  id: string;
  tipo: Tipo;
  status: Status;
  comportamento: Comportamento;
  respondeu: boolean;
  // null = pergunta sem fonte esperada.
  citou_item: boolean | null;
  // Os avisos esperados estão contidos nos detectados.
  avisos_ok: boolean;
  proibido_ok: boolean;
  claims_dropped_support: number;
  flagged_numbers: number;
  // O sistema ainda não pergunta de volta: em pedir_contexto isto é uma
  // lacuna informativa, não motivo de reprovação.
  nao_pergunta_de_volta: boolean;
  passou: boolean;
}

export function evaluateAnswer(q: GoldenQuestion, obs: AnswerObservation): AnswerResult {
  const respondeu = obs.answer !== null && obs.answer.trim() !== '';
  const proibidoOk = !(q.proibido_regex ?? []).some((pattern) => new RegExp(pattern, 'i').test(obs.answer ?? ''));
  const avisosOk = isSubset(q.avisos_esperados, obs.notices);

  let citouItem: boolean | null = null;
  if (q.fontes_esperadas.length > 0) {
    const esperados = new Set(
      obs.retrieved
        .filter((chunk) => q.fontes_esperadas.some((fonte) => chunkMatchesFonte(chunk, fonte)))
        .map((chunk) => chunk.chunk_id),
    );
    citouItem = obs.kept_claims_chunk_ids.some((ids) => ids.some((id) => esperados.has(id)));
  }

  let passou: boolean;
  switch (q.comportamento_esperado) {
    case 'responder':
      passou = respondeu && citouItem === true && proibidoOk;
      break;
    case 'recusar_sem_evidencia':
      passou = !respondeu;
      break;
    default:
      passou = avisosOk && proibidoOk;
  }

  return {
    id: q.id,
    tipo: q.tipo,
    status: q.status,
    comportamento: q.comportamento_esperado,
    respondeu,
    citou_item: citouItem,
    avisos_ok: avisosOk,
    proibido_ok: proibidoOk,
    claims_dropped_support: obs.claims_dropped_support,
    flagged_numbers: obs.flagged_numbers.length,
    nao_pergunta_de_volta: q.comportamento_esperado === 'pedir_contexto',
    passou,
  };
}

export interface AnswerAggregate {
  total: number;
  passou: number;
  responderam: number;
  com_fontes: number;
  citaram_item: number;
  claims_descartadas_por_suporte: number;
  numeros_sinalizados: number;
}

export function aggregateAnswer(results: AnswerResult[]): AnswerAggregate {
  const comFontes = results.filter((r) => r.citou_item !== null);
  return {
    total: results.length,
    passou: results.filter((r) => r.passou).length,
    responderam: results.filter((r) => r.respondeu).length,
    com_fontes: comFontes.length,
    citaram_item: comFontes.filter((r) => r.citou_item === true).length,
    claims_descartadas_por_suporte: results.reduce((sum, r) => sum + r.claims_dropped_support, 0),
    numeros_sinalizados: results.reduce((sum, r) => sum + r.flagged_numbers, 0),
  };
}

// ---------------------------------------------------------------------
// Baseline e gate de regressão
// ---------------------------------------------------------------------

export interface ComparableResult {
  id: string;
  status: Status;
  passou: boolean;
}

export interface Regression {
  id: string;
  motivo: string;
}

// Regressão = pergunta `validado` que PASSAVA no baseline e deixou de
// passar. Pergunta nova (sem par no baseline), removida ou ainda rascunho
// nunca é regressão.
export function findRegressions(baseline: ComparableResult[], current: ComparableResult[]): Regression[] {
  const before = new Map(baseline.map((result) => [result.id, result]));
  const regressions: Regression[] = [];
  for (const now of current) {
    const prev = before.get(now.id);
    if (now.status === 'validado' && prev?.passou === true && !now.passou) {
      regressions.push({ id: now.id, motivo: 'passava no baseline e deixou de passar' });
    }
  }
  return regressions;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    (groups[key(item)] ??= []).push(item);
  }
  return groups;
}
