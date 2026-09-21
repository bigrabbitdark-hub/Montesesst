import { Controller, Get, Req } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Roles('admin')
  @Get('alertas')
  getAlertas(@Req() req: any) {
    return req.withTenantContext((client: PoolClient) => this.dashboard.getAlertas(client));
  }
}
