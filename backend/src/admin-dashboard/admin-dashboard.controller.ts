import { Controller, Get, Query, Req } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

const DIAS_PERMITIDOS = [7, 30, 90];

function parseDias(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return DIAS_PERMITIDOS.includes(parsed) ? parsed : 30;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(parsed, 20);
}

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Roles('admin')
  @Get('alertas')
  getAlertas(@Req() req: any) {
    return req.withTenantContext((client: PoolClient) => this.dashboard.getAlertas(client));
  }

  @Roles('admin')
  @Get('financeiro')
  getFinanceiro(@Query('dias') dias: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: PoolClient) =>
      this.dashboard.getFinanceiro(client, parseDias(dias)),
    );
  }

  @Roles('admin')
  @Get('clientes-recentes')
  getClientesRecentes(@Query('limit') limit: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: PoolClient) =>
      this.dashboard.getClientesRecentes(client, parseLimit(limit)),
    );
  }
}
