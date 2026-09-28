// Métricas do runner de avaliação (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5).
// Módulo puro: recebe observações já coletadas do pipeline e devolve
// resultados — sem I/O, sem NestJS, sem LLM.
import { AVISOS, AvisoTipo, Comportamento, FonteEsperada, GoldenQuestion, Status, Tipo } from './golden/golden-schema';
import { chunkContainsItemHeading } from './golden/quote';

// Rubrica 0–5 complementar ao gate binário (spec
// docs/specs/assistente-banco-testes-12-niveis.md §4). Apenas FONTE e
// TRANSPARÊNCIA têm proxy automático a partir das métricas existentes;
// PRECISÃO/CONTEXTO/AÇÃO são `null` até revisão humana (ou LLM-juiz,
// que esta camada rejeitou explicitamente).
export interface Rubrica {
  // 0–5: 5 = oficial + item/trecho; 4 = oficial sem item; 1 = fonte
  // inadequada ou recusa sem evidência; 0 = nenhuma fonte. A recusa
  // correta (`recusar_sem_evidencia` com `falso_relevante !== true`) é
  // 1 (não há fonte, e o esperado era não haver).
  FONTE: number | null;
  // 0–5 declarado fora do escopo do proxy: 0–5 sempre `null` aqui.
  PRECISAO: null;
  CONTEXTO: null;
  // 0–4 (proxy): 4 = avisos_ok && proibido_ok; 3 = avisos_ok; 2 =
  // proibido_ok; 0 = nenhum. O 5 fica reservado para a revisão humana.
  TRANSPARENCIA: number | null;
  ACAO: null;
}

// Categorias que entram no agregado e no relatório. A inclusão das três
// com `null` aqui é para o relatório saber listar todas (sem ter que
// adivinhar a estrutura).
export const RUBRICA_CATEGORIAS = [
  'FONTE',
  'PRECISAO',
  'CONTEXTO',
  'TRANSPARENCIA',
  'ACAO',
] as const;
export type RubricaCategoria = (typeof RUBRICA_CATEGORIAS)[number];

export function emptyRubrica(): Rubrica {
  return { FONTE: null, PRECISAO: null, CONTEXTO: null, TRANSPARENCIA: null, ACAO: null };
}

export interface RetrievedChunkObs {
  chunk_id: string;
  source_code: string | null;
  content: string;
  similarity: number;
}

// Os avisos são comparados como CONJUNTO (sem ordem e sem repetição): um aviso
// repetido — no dataset ou no detector — não pode derrubar nem forjar o acerto.
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((value) => setB.has(value));
}

function isSubset(expected: readonly string[], detected: readonly string[]): boolean {
  const detectedSet = new Set(detected);
  return [...new Set(expected)].every((value) => detectedSet.has(value));
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
  // Rubrica 0–5 (proxy automático). Categorias sem proxy ficam `null`.
  // NUNCA é critério de gate — é camada de relatório (spec
  // docs/specs/assistente-banco-testes-12-niveis.md §4).
  rubrica: Rubrica;
  passou: boolean;
}

// Proxy automático de FONTE para Camada A. 5 se o item certo apareceu
// acima do limiar; 4 se só a NR; 1 se a recusa foi correta (esperava
// recusar e nada no top-k passou o limiar); 1 se a recusa falhou
// (esperava recusar mas havia fonte acima do limiar); 0 nos demais
// casos. Não tenta inferir qualidade da fonte textual — só acerto do
// índice buscado.
export function fonteProxyRetrieval(
  acertoItem: boolean | null,
  acertoNr: boolean | null,
  comportamento: Comportamento,
  falsoRelevante: boolean | null,
): number {
  if (acertoItem === true) return 5;
  if (acertoNr === true) return 4;
  if (comportamento === 'recusar_sem_evidencia') {
    // Recusa esperada — proxy 1 seja ela correta (falsoRelevante !==
    // true) ou não. O que importa é a categoria ter sido julgada
    // honestamente; a distinção certo/errado fica em `passou`.
    return 1;
  }
  return 0;
}

// Proxy de TRANSPARÊNCIA (Camada A). A Camada A não tem `proibido_ok`
// (só a Camada B mede o que a resposta efetivamente diz). 3 quando
// `avisos_ok` (avisos esperados batem com detectados); 0 quando não.
export function transparenciaProxyRetrieval(avisosOk: boolean): number {
  return avisosOk ? 3 : 0;
}

export function computeRubricaRetrieval(
  acertoItem: boolean | null,
  acertoNr: boolean | null,
  comportamento: Comportamento,
  falsoRelevante: boolean | null,
  avisosOk: boolean,
): Rubrica {
  return {
    FONTE: fonteProxyRetrieval(acertoItem, acertoNr, comportamento, falsoRelevante),
    PRECISAO: null,
    CONTEXTO: null,
    TRANSPARENCIA: transparenciaProxyRetrieval(avisosOk),
    ACAO: null,
  };
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
    rubrica: computeRubricaRetrieval(acertoItem, acertoNr, q.comportamento_esperado, falsoRelevante, avisosOk),
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
  // Média da rubrica por categoria (proxy automático). Apenas FONTE e
  // TRANSPARÊNCIA têm proxy; as outras ficam `null`. `null` na média de
  // uma categoria = nenhum resultado proxy-calculado para ela (ou a
  // categoria não tem proxy). É o agregado de relatório da rubrica;
  // nunca gate (spec assistente-banco-testes-12-niveis.md §4).
  rubrica_media: Record<RubricaCategoria, number | null>;
}

function meanRubrica(results: RetrievalResult[]): Record<RubricaCategoria, number | null> {
  const out = {} as Record<RubricaCategoria, number | null>;
  for (const cat of RUBRICA_CATEGORIAS) {
    const sample = results
      .map((r) => r.rubrica[cat as keyof Rubrica])
      .filter((v): v is number => typeof v === 'number');
    out[cat] = sample.length === 0 ? null : sample.reduce((a, b) => a + b, 0) / sample.length;
  }
  return out;
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
    rubrica_media: meanRubrica(results),
  };
}

// Precisão e recall do detector de avisos (detectNotices) por TIPO de aviso
// (spec §5.2). Por pergunta, cada tipo entra no máximo uma vez (Set), então
// aviso repetido não conta em dobro.
//  - tp: o tipo era esperado E foi detectado;
//  - fp: foi detectado mas não era esperado;
//  - fn: era esperado mas não foi detectado.
// precisao = tp/(tp+fp) e recall = tp/(tp+fn); null quando o denominador é 0
// (o tipo não apareceu nem esperado nem detectado, ou só de um dos lados) —
// nunca NaN.
export interface NoticeTypeStats {
  tp: number;
  fp: number;
  fn: number;
  precisao: number | null;
  recall: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function aggregateNotices(results: RetrievalResult[]): Record<AvisoTipo, NoticeTypeStats> {
  const stats = {} as Record<AvisoTipo, NoticeTypeStats>;
  for (const tipo of AVISOS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const result of results) {
      const esperado = new Set(result.avisos_esperados).has(tipo);
      const detectado = new Set(result.avisos_detectados).has(tipo);
      if (esperado && detectado) tp += 1;
      else if (detectado) fp += 1;
      else if (esperado) fn += 1;
    }
    stats[tipo] = { tp, fp, fn, precisao: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  }
  return stats;
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
  // Rubrica 0–5 (proxy automático). NUNCA é critério de gate.
  rubrica: Rubrica;
  passou: boolean;
}

// Proxy FONTE Camada B. 5 se citou item; 4 se citou NR mas errou item; 1
// se era recusa sem evidência e o sistema respondeu (falso relevante), ou
// era recusa e o sistema atendeu; 0 nos demais casos.
export function fonteProxyAnswer(
  citouItem: boolean | null,
  comportamento: Comportamento,
  respondeu: boolean,
): number {
  if (citouItem === true) return 5;
  if (comportamento === 'recusar_sem_evidencia') return 1;
  // Se a pergunta tinha fonte esperada, citou-item==false e o sistema
  // respondeu, o proxy é 0 — citou nada relevante.
  return 0;
}

// Proxy TRANSPARÊNCIA Camada B. 4 quando avisos_ok && proibido_ok;
// 3 quando só avisos_ok; 2 quando só proibido_ok; 0 quando nenhum.
export function transparenciaProxyAnswer(avisosOk: boolean, proibidoOk: boolean): number {
  if (avisosOk && proibidoOk) return 4;
  if (avisosOk) return 3;
  if (proibidoOk) return 2;
  return 0;
}

export function computeRubricaAnswer(
  citouItem: boolean | null,
  comportamento: Comportamento,
  respondeu: boolean,
  avisosOk: boolean,
  proibidoOk: boolean,
): Rubrica {
  return {
    FONTE: fonteProxyAnswer(citouItem, comportamento, respondeu),
    PRECISAO: null,
    CONTEXTO: null,
    TRANSPARENCIA: transparenciaProxyAnswer(avisosOk, proibidoOk),
    ACAO: null,
  };
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
    rubrica: computeRubricaAnswer(citouItem, q.comportamento_esperado, respondeu, avisosOk, proibidoOk),
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
  // Média da rubrica por categoria (proxy automático). Mesma forma da
  // RetrievalAggregate (ver lá).
  rubrica_media: Record<RubricaCategoria, number | null>;
}

function meanRubricaAnswer(results: AnswerResult[]): Record<RubricaCategoria, number | null> {
  const out = {} as Record<RubricaCategoria, number | null>;
  for (const cat of RUBRICA_CATEGORIAS) {
    const sample = results
      .map((r) => r.rubrica[cat as keyof Rubrica])
      .filter((v): v is number => typeof v === 'number');
    out[cat] = sample.length === 0 ? null : sample.reduce((a, b) => a + b, 0) / sample.length;
  }
  return out;
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
    rubrica_media: meanRubricaAnswer(results),
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
