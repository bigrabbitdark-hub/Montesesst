import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { OverviewService } from './overview.service';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Roles('admin')
  @Get()
  getMetrics(@Req() req: any) {
    return req.withTenantContext((client: any) => this.overview.getMetrics(client));
  }
}
