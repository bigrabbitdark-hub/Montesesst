// Trace de uma pergunta ao Assistente (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §4).
// Tipos + funções puras. O trace NUNCA carrega o texto da pergunta, das
// claims nem da resposta: só ids, similaridades, contagens e o hash da
// pergunta. É o que o runner de avaliação lê e o que o log de uso persiste.
import { createHash } from 'crypto';
import { NoticeType } from './question-notices';

export type QueryOutcome = 'respondeu' | 'fallback_sem_evidencia' | 'fallback_claims_descartadas';

export interface TraceNormativeChunk {
  chunk_id: string;
  document_id: string;
  source_code: string | null;
  similarity: number;
  passed_threshold: boolean;
}

export interface TraceChecklistItem {
  item_id: string;
  nr_code: string;
  similarity: number;
  passed_threshold: boolean;
}

// Fontes da empresa entram só como similaridade — sem ids.
export interface TraceSimilarity {
  similarity: number;
  passed_threshold: boolean;
}

export interface QueryTrace {
  question_hash: string;
  role: string;
  tenant_id: string | null;
  threshold: number;
  chunk_limit: number;
  // Todos os candidatos do topo, INCLUSIVE os cortados pelo limiar.
  normative: TraceNormativeChunk[];
  checklist: TraceChecklistItem[];
  company: TraceSimilarity[];
  operational_count: number;
  claims_total: number;
  claims_dropped_ids: number;
  claims_dropped_support: number;
  blocking_tokens: string[];
  flagged_numbers: string[];
  // Só os ids de trecho normativo que cada claim sobrevivente cita.
  kept_claims: { chunk_ids: string[] }[];
  notices: NoticeType[];
  outcome: QueryOutcome;
  used_attachment: boolean;
  model: string | null;
  latency_ms: number;
  retrieval_ms: number;
}

// SHA-256 da pergunta normalizada (minúsculas, espaços colapsados). Serve
// para contar perguntas repetidas; NÃO é anonimização forte (uma pergunta
// comum é adivinhável por dicionário).
export function hashQuestion(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

export interface ClaimSourceKinds {
  chunk_ids: string[];
  operational_ref_ids: string[];
  company_chunk_ids: string[];
  checklist_ref_ids: string[];
  uses_attachment: boolean;
}

// Regra de privacidade (spec §4.3): os tokens sinalizados (item/NR e números
// com unidade) só são gravados quando a claim cita EXCLUSIVAMENTE trechos
// normativos oficiais. Se ela cita documento da empresa, item operacional,
// checklist ou anexo, o token poderia vir de dado da empresa — grava-se só a
// contagem.
export function tokensAllowedForClaim(kinds: ClaimSourceKinds): boolean {
  return (
    kinds.chunk_ids.length > 0 &&
    kinds.operational_ref_ids.length === 0 &&
    kinds.company_chunk_ids.length === 0 &&
    kinds.checklist_ref_ids.length === 0 &&
    !kinds.uses_attachment
  );
}
