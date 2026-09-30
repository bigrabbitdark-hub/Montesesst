// Espelho de backend/src/dashboard/dashboard.service.ts (DashboardSummary / DashboardOverview).
export type ApiStatus = 'ok' | 'atencao' | 'critico';
export type ApiPrioridade = 'alta' | 'media' | 'baixa';

export interface ApiAttentionItem {
  tipo: string;
  titulo: string;
  prioridade: ApiPrioridade;
  data: string | null; // yyyy-mm-dd
  responsavel: 'empresa' | 'tecnico';
  link: string;
}

export interface ApiSummary {
  status: ApiStatus;
  score: number | null;
  empresa_destaque: boolean;
  updated_at: string;
  resumo: { pendencias: number; avisos: number; acoes_concluidas: number; inspecoes_pendentes: number };
  atencao: ApiAttentionItem[];
  proximos_eventos: ApiAttentionItem[];
  auditoria?: { pgr_pcmso: { risco_sem_exame: number; exame_sem_risco: number } };
}

export interface ApiOverview {
  filiais: number;
  funcionarios: number;
  documentos: number;
}
