import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';
import { DashboardService, DashboardSummary } from '../dashboard/dashboard.service';
import { TenantTechniciansService } from '../tenant-technicians/tenant-technicians.service';
import { VisitRequest, normalizeVisit } from './visits.service';

export interface MyDayEmpresaSummary {
  tenant_id: string;
  tenant_name: string;
  resumo: DashboardSummary;
}

export interface MyDayResult {
  visitas: {
    proximas: VisitRequest[];
    pendentes_de_confirmar: VisitRequest[];
  };
  empresas: MyDayEmpresaSummary[];
}

@Injectable()
export class TechnicianAgendaService {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly tenantTechnicians: TenantTechniciansService,
  ) {}

  async getMyDay(client: PoolClient, user: AuthenticatedUser): Promise<MyDayResult> {
    const proximasResult = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests
       WHERE technician_user_id = $1 AND status = 'confirmado'
         AND confirmed_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       ORDER BY confirmed_date ASC`,
      [user.id],
    );
    const pendentesResult = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests WHERE technician_user_id = $1 AND status = 'solicitado'
       ORDER BY created_at ASC`,
      [user.id],
    );

    const tenants = await this.tenantTechnicians.findMyTenants(
      client,
      user.id,
      user.role as 'tecnico' | 'parceiro',
    );

    // Sequencial, não Promise.all: cada tenant faz múltiplas subconsultas
    // no mesmo client (o próprio DashboardService.getSummary já roda 4
    // queries em paralelo internamente) — encadear N desses em paralelo no
    // mesmo client soma ao aviso de depreciação do node-postgres sobre
    // client.query concorrente sem necessidade real (nenhuma chamada
    // externa envolvida aqui, só Postgres — não há ganho de latência que
    // justifique o risco).
    const empresas: MyDayEmpresaSummary[] = [];
    for (const tenant of tenants) {
      const resumo = await this.dashboard.getSummary(client, tenant.tenant_id);
      empresas.push({ tenant_id: tenant.tenant_id, tenant_name: tenant.tenant_name, resumo });
    }

    return {
      visitas: {
        proximas: proximasResult.rows.map(normalizeVisit),
        pendentes_de_confirmar: pendentesResult.rows.map(normalizeVisit),
      },
      empresas,
    };
  }
}
