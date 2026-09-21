// Resumo do log de uso real do Assistente (Etapas 2 e 3 da Confiabilidade
// do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md
// §4.5). Módulo puro: agrega linhas já lidas de assistant_query_log.
export interface UsageRow {
  role: string;
  outcome: string;
  notices: string[];
  retrieved: { similarity: number; passed_threshold: boolean }[];
  claims_total: number;
  claims_dropped_ids: number;
  claims_dropped_support: number;
  blocking_tokens: string[];
  flagged_numbers: string[];
  latency_ms: number;
}

export interface UsageSummary {
  total: number;
  por_desfecho: Record<string, number>;
  // fallback_* / total; null sem linhas.
  taxa_fallback: number | null;
  por_papel: Record<string, number>;
  avisos: Record<string, number>;
  melhor_similaridade: { p50: number | null; p90: number | null };
  claims: { total: number; descartadas_ids: number; descartadas_suporte: number };
  numeros_sinalizados_top: { token: string; vezes: number }[];
  tokens_bloqueados_top: { token: string; vezes: number }[];
  latencia_media_ms: number | null;
}

function count(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function top(values: string[], limit: number): { token: string; vezes: number }[] {
  return Object.entries(count(values))
    .map(([token, vezes]) => ({ token, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.token.localeCompare(b.token))
    .slice(0, limit);
}

// Nearest-rank sobre a lista já ordenada.
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  const best = rows
    .filter((row) => row.retrieved.length > 0)
    .map((row) => Math.max(...row.retrieved.map((chunk) => chunk.similarity)))
    .sort((a, b) => a - b);
  const fallbacks = rows.filter((row) => row.outcome.startsWith('fallback')).length;

  return {
    total: rows.length,
    por_desfecho: count(rows.map((row) => row.outcome)),
    taxa_fallback: rows.length > 0 ? fallbacks / rows.length : null,
    por_papel: count(rows.map((row) => row.role)),
    avisos: count(rows.flatMap((row) => row.notices)),
    melhor_similaridade: { p50: percentile(best, 50), p90: percentile(best, 90) },
    claims: {
      total: rows.reduce((sum, row) => sum + row.claims_total, 0),
      descartadas_ids: rows.reduce((sum, row) => sum + row.claims_dropped_ids, 0),
      descartadas_suporte: rows.reduce((sum, row) => sum + row.claims_dropped_support, 0),
    },
    numeros_sinalizados_top: top(rows.flatMap((row) => row.flagged_numbers), 10),
    tokens_bloqueados_top: top(rows.flatMap((row) => row.blocking_tokens), 10),
    latencia_media_ms:
      rows.length > 0 ? Math.round(rows.reduce((sum, row) => sum + row.latency_ms, 0) / rows.length) : null,
  };
}
