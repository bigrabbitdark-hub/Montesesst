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

export interface AlertInput {
  services: { postgres: boolean; redis: boolean; site: boolean };
  disk_used_percent: number;
  ram_used_percent: number;
  payments_rejected_7d: number;
  payments_pending_stale: number;
  documentos_vencendo: number;
  epis_vencendo: number;
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

const ORDEM: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

export function computeAlerts(
  input: AlertInput,
  options: { ramEnabled?: boolean } = {},
): AlertResult {
  const ramEnabled = options.ramEnabled ?? RAM_ALERT_ENABLED;
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

  itens.sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade]);

  const contagem: Record<AlertSeverity, number> = { critico: 0, atencao: 0, info: 0 };
  for (const item of itens) contagem[item.severidade] += 1;

  return { contagem, itens };
}
