import { FIELD_LABELS } from '@/lib/employees-history';

// Rótulos dos campos vêm do histórico, para a revisão e o histórico falarem a mesma língua.
export { FIELD_LABELS };

export interface FieldConflict {
  field: string;
  current: string;
  proposed: string;
}
/** Campo vazio no cadastro que o documento sugere preencher (não há valor atual a comparar). */
export interface FieldSuggestion {
  field: string;
  proposed: string;
}
export interface ExtractionItem {
  line: number;
  kind: 'novo' | 'conflito' | 'sugestao' | 'invalida';
  full_name?: string;
  cpf_masked?: string;
  conflicts?: FieldConflict[];
  /** Em `sugestao` é a lista inteira; em `conflito` são sugestões da mesma linha (campos distintos dos conflitos). */
  suggestions?: FieldSuggestion[];
  /** Trecho do documento já mascarado pelo backend (sem CPF); só texto, nunca HTML. */
  evidence?: string;
  /** Em `novo`: campos não-CPF que serão gravados ao aprovar (só os preenchidos, já normalizados). */
  fields?: { field: string; value: string }[];
  reason?: string;
}
export type ExtractionMethod = 'planilha' | 'texto' | 'texto+ia';
export type ExtractionStatus = 'processando' | 'aplicado' | 'requer_revisao' | 'sem_dados' | 'ilegivel' | 'erro' | 'expirado';
export interface Extraction {
  id: string;
  tenant_id: string;
  document_id: string;
  status: ExtractionStatus;
  summary: {
    applied: number;
    unchanged: number;
    novo: number;
    conflito: number;
    invalida: number;
    ignored_rows: number;
    method?: ExtractionMethod;
    ai_used?: boolean;
    ai_attempted?: boolean;
    /** true quando a IA não cobriu todas as pessoas do documento. */
    ai_partial?: boolean;
    /** Quando a revisão expirou (status `expirado`). */
    expired_at?: string;
    /** Texto estático do backend (motivo do "ilegível"); nunca conteúdo da planilha. */
    detail?: string;
    resolved?: { aplicados: number; ignorados: number };
  };
  items: ExtractionItem[];
  created_at: string;
  resolved_at: string | null;
  /** true quando o backend devolveu uma extração já existente do mesmo arquivo. */
  reused?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AI_NOTICE = 'Leitura feita com apoio de IA: confira cada valor antes de aplicar.';
export const AI_PARTIAL_NOTICE = 'A IA cobriu só parte do documento: pode haver funcionários que não aparecem aqui.';
export const WAIT_NOTICE = 'Isto pode levar alguns minutos para documentos grandes.';

/** Itens que exigem decisão (as inválidas ficam fora). */
export const isPending = (i: ExtractionItem) => i.kind === 'novo' || i.kind === 'conflito' || i.kind === 'sugestao';
export const isTextMethod = (s: Extraction['summary']) => s.method === 'texto' || s.method === 'texto+ia';
export const usedAi = (s: Extraction['summary']) => s.ai_used === true;

/** Remove controles invisíveis e de direção (RTL/ZWSP) de texto vindo do documento antes de exibir. */
export function safeText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '') : '';
}
/** Lista segura: valor que não é array vira lista vazia. */
export const asList = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const PROCESSING_NOTICE = 'Este documento ainda está sendo lido. Vamos avisar quando terminar.';
export const UNEXPECTED_RESPONSE = 'Resposta inesperada do servidor. Atualize a página para conferir.';

const ZERO_SUMMARY = { applied: 0, unchanged: 0, novo: 0, conflito: 0, invalida: 0, ignored_rows: 0 };

export function statusMessage(e: Extraction): string {
  const s = { ...ZERO_SUMMARY, ...(e.summary ?? {}) } as Extraction['summary'];
  const text = isTextMethod(s);
  if (e.status === 'expirado') return s.detail || 'A revisão expirou. Reenvie o documento.';
  if (e.reused && e.status === 'processando') return PROCESSING_NOTICE;
  if (e.reused) return text ? 'Este documento já foi enviado e está aguardando revisão.' : 'Esta planilha já foi enviada e está aguardando revisão.';
  const withAi = (msg: string) => (usedAi(s) ? `${msg} ${AI_NOTICE}${s.ai_partial ? ` ${AI_PARTIAL_NOTICE}` : ''}` : msg);
  switch (e.status) {
    case 'aplicado': {
      const base = `${plural(s.applied, 'funcionário atualizado', 'funcionários atualizados')}, ${s.unchanged} sem mudança.`;
      return withAi(s.invalida > 0 ? `${base} ${plural(s.invalida, 'linha com problema', 'linhas com problema')}.` : base);
    }
    case 'requer_revisao': {
      const n = asList<ExtractionItem>(e.items).filter(isPending).length || s.novo + s.conflito;
      let msg = `Há ${plural(n, 'item', 'itens')} para revisar.`;
      if (text) msg += ' Nada foi alterado no cadastro ainda.';
      // detail é texto estático do backend (ex.: IA indisponível); com cobertura parcial o aviso próprio já o diz.
      if (text && s.detail && !s.ai_partial) msg += ` ${s.detail}`;
      return withAi(msg);
    }
    case 'sem_dados':
      return s.detail || (text ? 'Nenhum funcionário foi identificado no documento.' : 'Nenhuma linha de funcionário encontrada na planilha.');
    case 'ilegivel':
      return s.detail || (text ? 'Não foi possível ler o documento. Envie a planilha modelo (.xlsx).' : 'Não foi possível ler a planilha. Use o modelo oficial (.xlsx).');
    case 'erro':
      return s.detail || (text ? 'Não foi possível ler o documento agora. Tente novamente em instantes.' : 'Falha ao processar a planilha. Tente novamente.');
    default:
      return text ? 'Documento em processamento.' : 'Planilha em processamento.';
  }
}

const REASONS: Record<string, string> = { outra_filial: 'Já cadastrado em outra filial' };

export function reasonLabel(reason?: string): string {
  if (!reason) return 'Linha com problema';
  return REASONS[reason] ?? reason;
}
