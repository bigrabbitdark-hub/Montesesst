// Contratos das respostas que o painel consome. Espelham os endpoints do
// backend (overview, system-status, ai-copilot/usage, admin/ai-usage,
// admin/dashboard/*, audit-log). `AuditLogRow` NÃO inclui `detail`: o card de
// logs não deve ler nem exibir esse campo (contém e-mail em falhas de login).
export interface SystemStatus {
  memory: { total_gb: number; free_gb: number; used_percent: number };
  cpu: { cores: number; load_avg_1m: number; load_avg_5m: number; load_avg_15m: number };
  disk: { total_gb: number; free_gb: number; used_percent: number };
  services: {
    postgres: { reachable: boolean; active_connections: number | null };
    redis: { reachable: boolean };
    frontend: { reachable: boolean };
  };
}

export interface OverviewMetrics {
  empresas_ativas: number;
  tecnicos_vinculados: number;
  parceiros_vinculados: number;
  inspecoes_no_mes: number;
  documentos_vencendo: number;
  epis_vencendo: number;
  assinaturas_ativas: number;
  receita_mensal_cents: number;
  planos_acao_pendentes: number;
}

export type AlertSeverity = 'critico' | 'atencao' | 'info';

export interface AlertItem {
  id: string;
  severidade: AlertSeverity;
  titulo: string;
  detalhe: string;
  href: string;
}

export interface AlertasResponse {
  gerado_em: string;
  contagem: Record<AlertSeverity, number>;
  itens: AlertItem[];
}

export interface FinanceiroPeriodo {
  cobrado_cents: number;
  aprovado_cents: number;
  pendente_cents: number;
}

export interface PagamentoRecente {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
  cliente: string | null;
  plano: string | null;
}

export interface FinanceiroResponse {
  periodo_dias: number;
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
  hoje: FinanceiroPeriodo;
  mes: FinanceiroPeriodo & { recusado_cents: number };
  recentes: PagamentoRecente[];
}

export interface ClienteRecente {
  id: string;
  nome: string;
  plano: string;
  status: string;
  mrr_cents: number | null;
  ultimo_acesso: string | null;
  created_at: string;
}

export interface OpenRouterUsage {
  configured: boolean;
  provider: 'openrouter';
  is_free_tier?: boolean;
  total_credits?: number;
  total_usage?: number;
  usage_monthly?: number;
  low_balance_warning?: boolean;
  dashboard_url: string;
  error?: string;
}

export interface MiniMaxUsage {
  total_calls: number;
  total_tokens: number;
  by_capability: {
    capability: string;
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }[];
  last_7_days: { date: string; total_tokens: number }[];
}

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_full_name: string | null;
  action: string;
  resource_type: string;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
}
