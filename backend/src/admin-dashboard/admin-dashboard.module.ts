import { Module } from '@nestjs/common';
import { OverviewModule } from '../overview/overview.module';
import { SystemStatusModule } from '../system-status/system-status.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [OverviewModule, SystemStatusModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
