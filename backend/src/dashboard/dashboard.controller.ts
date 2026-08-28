import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('empresa')
  @Get('summary')
  summary(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.dashboard.getSummary(client, req.user.tenantId),
    );
  }
}
