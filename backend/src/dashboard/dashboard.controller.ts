import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @Get('summary')
  summary(@Query('tenant_id') tenantIdQuery: string | undefined, @Req() req: any) {
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
      return this.dashboard.getSummary(client, tenantId);
    });
  }
}
