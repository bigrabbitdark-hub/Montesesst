// Grupos de status de `payment_events`. O valor gravado vem de
// `payment.status` do Mercado Pago (não do status de agendamento) — ver
// docs/specs/fase-7-financeiro.md. Status fora dos três grupos (refunded,
// charged_back, in_mediation…) só contam em "cobrado" e aparecem com o
// status bruto nas listas.
export const APPROVED_STATUSES = ['approved'] as const;
export const PENDING_STATUSES = ['pending', 'in_process', 'authorized'] as const;
export const REJECTED_STATUSES = ['rejected', 'cancelled'] as const;
