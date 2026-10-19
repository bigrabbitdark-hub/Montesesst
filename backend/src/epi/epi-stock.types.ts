export const MOVEMENT_DIRECTION = {
  abertura: 1,
  entrada: 1,
  devolucao: 1,
  entrega: -1,
  troca: -1,
  baixa: -1,
} as const;

export type LedgerMovementType = keyof typeof MOVEMENT_DIRECTION;
export type StockMovementType = LedgerMovementType | 'ajuste' | 'estorno';

export interface EpiMovement {
  id: string;
  tenant_id: string;
  tenant_epi_id: string;
  type: StockMovementType;
  direction: 1 | -1;
  quantity: number;
  balance_after: number;
  employee_id: string | null;
  supplier: string | null;
  lot_id: string | null;
  reason: string | null;
  occurred_at: string;
  delivery_id: string | null;
  reverses_movement_id: string | null;
  idempotency_key: string;
  created_by_user_id: string;
  created_at: string;
}

export interface ApplyMovementInput {
  tenantEpiId: string;
  type: StockMovementType;
  direction?: 1 | -1; // obrigatório só em ajuste/estorno
  quantity: number;
  employeeId?: string;
  supplier?: string;
  lotId?: string;
  lotCode?: string;
  lotValidUntil?: string;
  reason?: string;
  occurredAt?: string;
  reversesMovementId?: string;
  deliveryId?: string;
  idempotencyKey: string;
  userId: string;
  // Chamado depois da checagem de repetição e das validações, antes do INSERT
  // do movimento: usado para criar a entrega vinculada sem duplicá-la numa repetição.
  beforeInsert?: (epi: { id: string; tenant_id: string }) => Promise<string | undefined>;
}

export interface ApplyResult {
  movement: EpiMovement;
  replayed: boolean;
}
