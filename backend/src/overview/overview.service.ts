import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

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

// Uma única query com subqueries escalares — uma linha, um round-trip.
// Cada tabela consultada já tem bypass de RLS pra admin desde a fase em
// que foi criada; este service só precisa que o caller seja admin
// (garantido pelo @Roles('admin') no controller).
@Injectable()
export class OverviewService {
  async getMetrics(client: PoolClient): Promise<OverviewMetrics> {
    const result = await client.query<OverviewMetrics>(`
      SELECT
        (SELECT count(*) FROM tenants WHERE status = 'ativo')::int AS empresas_ativas,
        (SELECT count(DISTINCT technician_id) FROM tenant_technicians WHERE status = 'ativo')::int AS tecnicos_vinculados,
        (SELECT count(DISTINCT partner_id) FROM tenant_partners WHERE status = 'ativo')::int AS parceiros_vinculados,
        (SELECT count(*) FROM inspections
           WHERE visited_at >= date_trunc('month', CURRENT_DATE)::date
             AND visited_at < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date)::int AS inspecoes_no_mes,
        (SELECT count(*) FROM documents WHERE expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS documentos_vencendo,
        (SELECT count(*) FROM tenant_epis WHERE ca_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS epis_vencendo,
        (SELECT count(*) FROM subscriptions WHERE status = 'authorized')::int AS assinaturas_ativas,
        (SELECT COALESCE(sum(p.price_cents), 0) FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
           WHERE s.status = 'authorized')::int AS receita_mensal_cents,
        (SELECT count(*) FROM action_plans WHERE status = 'pendente')::int AS planos_acao_pendentes
    `);
    return result.rows[0];
  }
}
