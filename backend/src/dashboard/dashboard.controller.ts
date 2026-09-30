import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @Get('summary')
  summary(@Query('tenant_id') tenantIdQuery: string | undefined, @Req() req: any) {
    return this.withTargetTenant(req, tenantIdQuery, (client, tenantId) => this.dashboard.getSummary(client, tenantId));
  }

  // Contagens (só números, sem nomes/PII) para os KPIs do painel novo.
  @Roles('empresa', 'tecnico', 'parceiro')
  @Get('overview')
  overview(@Query('tenant_id') tenantIdQuery: string | undefined, @Req() req: any) {
    return this.withTargetTenant(req, tenantIdQuery, (client, tenantId) => this.dashboard.getOverview(client, tenantId));
  }

  private withTargetTenant<T>(
    req: any,
    tenantIdQuery: string | undefined,
    run: (client: any, tenantId: string) => Promise<T>,
  ): Promise<T> {
    const user = req.user;
    // `tenantIdQuery` é só o ALVO (qual empresa o técnico/parceiro quer
    // ver) — vem da query, então é controlado por quem chama e nunca
    // pode virar contexto de RLS. O contexto vem sempre do usuário
    // autenticado, igual ao padrão de pente-fino.controller.ts.
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? tenantIdQuery : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext(async (client: any) => {
      if (user.role !== 'empresa') {
        await this.dashboard.assertTenantLinked(client, tenantId);
      }
      return run(client, tenantId);
    });
  }
}
