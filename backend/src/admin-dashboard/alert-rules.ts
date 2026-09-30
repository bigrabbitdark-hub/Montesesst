// Regras de alerta determinísticas da Visão Geral do admin. Função pura:
// recebe números já coletados e devolve a lista de alertas — não toca em
// banco, rede nem relógio, para ser testável sem infraestrutura.
export type AlertSeverity = 'critico' | 'atencao' | 'info';

export interface AlertItem {
  id: string;
  severidade: AlertSeverity;
  titulo: string;
  detalhe: string;
  href: string;
}

// ITEM 013: estado do saldo do OpenRouter, lido do CACHE gravado pelo
// OpenRouterCreditMonitorCronService (nunca uma chamada de rede aqui — ver comentário em
// AdminDashboardService.getAlertas). `null` = o cron ainda nunca rodou (ex.: logo após o
// deploy desta funcionalidade) — tratado como "sem informação", não como falha.
export interface OpenRouterCreditInput {
  checked_at: string;
  check_succeeded: boolean;
  is_unlimited: boolean;
  limit_remaining_usd: number | null;
  error_message: string | null;
}

export interface AlertInput {
  services: { postgres: boolean; redis: boolean; site: boolean };
  disk_used_percent: number;
  ram_used_percent: number;
  payments_rejected_7d: number;
  payments_pending_stale: number;
  documentos_vencendo: number;
  epis_vencendo: number;
  openrouter: OpenRouterCreditInput | null;
  // ITEM 014: gasto de HOJE (America/Sao_Paulo) somando MiniMax (estimado, sem API de
  // saldo — ver minimax-cost.util.ts) e OpenRouter (usage_daily REAL, já vem do próprio
  // openrouter_credit_status — ver ITEM 013).
  ai_cost_today_usd: number;
}

export interface AlertResult {
  contagem: Record<AlertSeverity, number>;
  itens: AlertItem[];
}

export const THRESHOLDS = {
  DISK_ATENCAO: 80,
  DISK_CRITICO: 90,
  RAM_ATENCAO: 90,
  RAM_CRITICO: 95,
} as const;

export const PENDING_STALE_DAYS = 3;
export const REJECTED_WINDOW_DAYS = 7;

// `used_percent` de memória sai de os.freemem(), que em Linux pode ignorar
// cache de página e superestimar o uso. Só ligar depois de conferir contra
// `free -h` (MemAvailable) na VPS — ver Tarefa 14 do plano.
export const RAM_ALERT_ENABLED = true;

// ITEM 013/014 — valores padrão; sobrescrevíveis via `options` (lidos de env no chamador,
// nunca aqui dentro — esta função continua pura). US$ porque é a moeda nativa das duas
// APIs (OpenRouter e a estimativa de MiniMax, ver minimax-cost.util.ts).
export const OPENROUTER_LOW_CREDIT_USD_DEFAULT = 5;
export const AI_DAILY_COST_CAP_USD_DEFAULT = 20;

const ORDEM: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

// "US$ 3,45" — pt-BR (vírgula decimal), consistente com o resto da Visão Geral do admin
// (valores em centavos formatados como moeda brasileira nas outras telas).
function fmtUsd(value: number): string {
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function computeAlerts(
  input: AlertInput,
  options: { ramEnabled?: boolean; openrouterLowCreditUsd?: number; aiDailyCostCapUsd?: number } = {},
): AlertResult {
  const ramEnabled = options.ramEnabled ?? RAM_ALERT_ENABLED;
  const openrouterLowCreditUsd = options.openrouterLowCreditUsd ?? OPENROUTER_LOW_CREDIT_USD_DEFAULT;
  const aiDailyCostCapUsd = options.aiDailyCostCapUsd ?? AI_DAILY_COST_CAP_USD_DEFAULT;
  const itens: AlertItem[] = [];

  if (!input.services.postgres) {
    itens.push({
      id: 'postgres_down',
      severidade: 'critico',
      titulo: 'Banco de dados inacessível',
      detalhe: 'O PostgreSQL não respondeu à checagem de conexão.',
      href: '/admin/overview',
    });
  }
  if (!input.services.redis) {
    itens.push({
      id: 'redis_down',
      severidade: 'critico',
      titulo: 'Redis inacessível',
      detalhe: 'O Redis não respondeu ao ping.',
      href: '/admin/overview',
    });
  }
  if (!input.services.site) {
    itens.push({
      id: 'site_down',
      severidade: 'critico',
      titulo: 'Site inacessível',
      detalhe: 'O frontend não respondeu à checagem de saúde.',
      href: '/admin/overview',
    });
  }

  if (input.disk_used_percent >= THRESHOLDS.DISK_ATENCAO) {
    itens.push({
      id: 'disk_high',
      severidade: input.disk_used_percent >= THRESHOLDS.DISK_CRITICO ? 'critico' : 'atencao',
      titulo: `Disco em ${Math.round(input.disk_used_percent)}%`,
      detalhe: 'Libere espaço ou amplie o disco da VPS antes que chegue a 100%.',
      href: '/admin/overview',
    });
  }

  if (ramEnabled && input.ram_used_percent >= THRESHOLDS.RAM_ATENCAO) {
    itens.push({
      id: 'ram_high',
      severidade: input.ram_used_percent >= THRESHOLDS.RAM_CRITICO ? 'critico' : 'atencao',
      titulo: `Memória em ${Math.round(input.ram_used_percent)}%`,
      detalhe: 'Uso de RAM acima do normal na VPS.',
      href: '/admin/overview',
    });
  }

  if (input.payments_rejected_7d > 0) {
    const n = input.payments_rejected_7d;
    itens.push({
      id: 'payments_rejected',
      severidade: 'atencao',
      titulo:
        n === 1
          ? `1 cobrança recusada nos últimos ${REJECTED_WINDOW_DAYS} dias`
          : `${n} cobranças recusadas nos últimos ${REJECTED_WINDOW_DAYS} dias`,
      detalhe: 'Confira as assinaturas afetadas em Financeiro.',
      href: '/admin/financeiro',
    });
  }

  if (input.payments_pending_stale > 0) {
    const n = input.payments_pending_stale;
    itens.push({
      id: 'payments_pending_stale',
      severidade: 'atencao',
      titulo:
        n === 1
          ? `1 cobrança pendente há mais de ${PENDING_STALE_DAYS} dias`
          : `${n} cobranças pendentes há mais de ${PENDING_STALE_DAYS} dias`,
      detalhe: 'O Mercado Pago não confirmou nem recusou essas cobranças.',
      href: '/admin/financeiro',
    });
  }

  if (input.documentos_vencendo > 0) {
    const n = input.documentos_vencendo;
    itens.push({
      id: 'documents_expiring',
      severidade: 'info',
      titulo: n === 1 ? '1 documento vence em 30 dias' : `${n} documentos vencem em 30 dias`,
      detalhe: 'Somando todas as empresas.',
      href: '/admin/empresas',
    });
  }

  if (input.epis_vencendo > 0) {
    const n = input.epis_vencendo;
    itens.push({
      id: 'epis_expiring',
      severidade: 'info',
      titulo: n === 1 ? '1 EPI com CA vencendo em 30 dias' : `${n} EPIs com CA vencendo em 30 dias`,
      detalhe: 'Somando todas as empresas.',
      href: '/admin/empresas',
    });
  }

  // ITEM 013 — crédito do OpenRouter. `openrouter === null` (cron nunca rodou) e chave
  // sem teto (`is_unlimited`) nunca geram alerta — não há o que avisar.
  const or = input.openrouter;
  if (or && or.check_succeeded && !or.is_unlimited && or.limit_remaining_usd !== null) {
    if (or.limit_remaining_usd <= 0) {
      itens.push({
        id: 'openrouter_credit_zero',
        severidade: 'critico',
        titulo: 'Sem crédito no OpenRouter',
        detalhe:
          'Embeddings de documentos, o copiloto de checklist e o provedor alternativo de resposta normativa devem estar falhando agora.',
        href: '/admin/overview',
      });
    } else if (or.limit_remaining_usd < openrouterLowCreditUsd) {
      itens.push({
        id: 'openrouter_credit_low',
        severidade: 'atencao',
        titulo: `Crédito baixo no OpenRouter (${fmtUsd(or.limit_remaining_usd)} restantes)`,
        detalhe: 'Adicione crédito antes que zere e interrompa embeddings e outros recursos.',
        href: '/admin/overview',
      });
    }
  } else if (or && !or.check_succeeded) {
    itens.push({
      id: 'openrouter_check_failed',
      severidade: 'atencao',
      titulo: 'Não foi possível consultar o crédito do OpenRouter',
      detalhe: or.error_message ? `Última tentativa: ${or.error_message}` : 'Verifique o log do backend.',
      href: '/admin/overview',
    });
  }

  // ITEM 014 — teto de custo diário de IA (MiniMax estimado + OpenRouter real). Decisão do
  // fundador (2026-09-28): só alertar, nunca bloquear nenhuma chamada por causa disto.
  if (input.ai_cost_today_usd > aiDailyCostCapUsd) {
    itens.push({
      id: 'ai_daily_cost_high',
      severidade: 'atencao',
      titulo: `Gasto de IA hoje: ${fmtUsd(input.ai_cost_today_usd)}`,
      detalhe: `Acima do teto configurado de ${fmtUsd(aiDailyCostCapUsd)}/dia. Nenhuma IA foi bloqueada — é só um aviso.`,
      href: '/admin/overview',
    });
  }

  itens.sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade]);

  const contagem: Record<AlertSeverity, number> = { critico: 0, atencao: 0, info: 0 };
  for (const item of itens) contagem[item.severidade] += 1;

  return { contagem, itens };
}
