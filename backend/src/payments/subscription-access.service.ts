import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

// Estado de acesso pago de UM sujeito (a empresa ou o técnico), decidido a partir
// de `subscriptions`. Fonte única da regra do ITEM 002: usado tanto pela
// SubscriptionStatusGuard (que bloqueia) quanto por GET /subscriptions/me (que
// deixa o frontend explicar o bloqueio) — assim os dois nunca divergem.
//   - 'ativa'    existe assinatura authorized                       -> libera
//   - 'pendente' checkout em andamento (pending criado há < 3 dias) -> libera
//   - 'inativa'  já teve assinatura (cancelled/paused) e nenhuma ativa/pendente -> BLOQUEIA
//   - 'trial'    nunca assinou                                      -> libera
// O 'pending' expira (3 dias): nada o limpa, então um cliente que cancelou e
// abandonou um checkout ficaria com um 'pending' eterno e nunca seria bloqueado.
export type SubscriptionAccess = 'trial' | 'ativa' | 'pendente' | 'inativa';

export interface AccessSubject {
  id: string;
  tenantId: string | null;
  role: string;
}

@Injectable()
export class SubscriptionAccessService {
  constructor(private readonly db: DatabaseService) {}

  async stateFor(user: AccessSubject): Promise<SubscriptionAccess> {
    return this.db.withTenantContext(
      { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
      async (client) => {
        const result = await client.query<{ has_authorized: boolean; has_recent_pending: boolean; has_lapsed: boolean }>(
          `SELECT
             EXISTS (
               SELECT 1 FROM subscriptions
               WHERE (tenant_id = $1 OR technician_user_id = $2) AND status = 'authorized'
             ) AS has_authorized,
             EXISTS (
               SELECT 1 FROM subscriptions
               WHERE (tenant_id = $1 OR technician_user_id = $2)
                 AND status = 'pending' AND created_at > now() - interval '3 days'
             ) AS has_recent_pending,
             EXISTS (
               SELECT 1 FROM subscriptions
               WHERE (tenant_id = $1 OR technician_user_id = $2) AND status IN ('cancelled', 'paused')
             ) AS has_lapsed`,
          [user.tenantId ?? null, user.id],
        );
        const row = result.rows[0];
        if (row.has_authorized) return 'ativa';
        if (row.has_recent_pending) return 'pendente';
        if (row.has_lapsed) return 'inativa';
        return 'trial';
      },
    );
  }
}
