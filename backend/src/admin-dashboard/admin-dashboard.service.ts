import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OverviewService } from '../overview/overview.service';
import { SystemStatusService } from '../system-status/system-status.service';
import { AlertResult, computeAlerts, PENDING_STALE_DAYS, REJECTED_WINDOW_DAYS } from './alert-rules';
import { PENDING_STATUSES, REJECTED_STATUSES } from './payment-status';

export interface AlertasResponse extends AlertResult {
  gerado_em: string;
}

// Só leitura. Chamado apenas por rotas @Roles('admin'); o `client` vem de
// req.withTenantContext, então as políticas RLS de admin já se aplicam.
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly systemStatus: SystemStatusService,
    private readonly overview: OverviewService,
  ) {}

  // Nenhuma chamada externa aqui (nada de OpenRouter etc.): só banco e `os`,
  // para a resposta ser rápida e o sino da topbar nunca travar por terceiro.
  async getAlertas(client: PoolClient): Promise<AlertasResponse> {
    const [status, metrics, payments] = await Promise.all([
      this.systemStatus.getStatus(),
      this.overview.getMetrics(client),
      this.countPaymentAlerts(client),
    ]);

    const result = computeAlerts({
      services: {
        postgres: status.services.postgres.reachable,
        redis: status.services.redis.reachable,
        site: status.services.frontend.reachable,
      },
      disk_used_percent: status.disk.used_percent,
      ram_used_percent: status.memory.used_percent,
      payments_rejected_7d: payments.rejected,
      payments_pending_stale: payments.pendingStale,
      documentos_vencendo: metrics.documentos_vencendo,
      epis_vencendo: metrics.epis_vencendo,
    });

    return { gerado_em: new Date().toISOString(), ...result };
  }

  private async countPaymentAlerts(
    client: PoolClient,
  ): Promise<{ rejected: number; pendingStale: number }> {
    const result = await client.query<{ rejected: number; pending_stale: number }>(
      `SELECT
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($1::text[])
              AND occurred_at >= now() - make_interval(days => $3::int))::int AS rejected,
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($2::text[])
              AND occurred_at < now() - make_interval(days => $4::int))::int AS pending_stale`,
      [[...REJECTED_STATUSES], [...PENDING_STATUSES], REJECTED_WINDOW_DAYS, PENDING_STALE_DAYS],
    );
    return { rejected: result.rows[0].rejected, pendingStale: result.rows[0].pending_stale };
  }
}
