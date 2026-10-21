import { APPROVED_STATUSES } from '../admin-dashboard/payment-status';
import type { SubscriptionAccess } from '../payments/subscription-access.service';

// Cliente "ativa" (há assinatura authorized) cujo pagamento mais recente não foi
// aprovado está com pendência. trial/pendente/inativa nunca são inadimplentes;
// sem pagamento algum também não há pendência.
export function temPendencia(situacao: SubscriptionAccess, ultimoStatus: string | null): boolean {
  if (situacao !== 'ativa' || ultimoStatus === null) return false;
  return !(APPROVED_STATUSES as readonly string[]).includes(ultimoStatus);
}

// Datas no formato YYYY-MM-DD (já no fuso America/Sao_Paulo). Nunca negativo.
export function diasEmAtraso(dataPagamento: string, hoje: string): number {
  const dias = Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dataPagamento}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, dias);
}

export function somarMrr(precos: number[]): number {
  return precos.reduce((soma, p) => soma + p, 0);
}
