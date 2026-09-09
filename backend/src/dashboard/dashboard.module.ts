import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { WeeklyDigestService } from './weekly-digest.service';
import { DocumentsModule } from '../documents/documents.module';
import { PositionsModule } from '../positions/positions.module';
import { FireSafetyEquipmentModule } from '../fire-safety-equipment/fire-safety-equipment.module';
import { FireBrigadeModule } from '../fire-brigade/fire-brigade.module';

@Module({
  imports: [DocumentsModule, PositionsModule, FireSafetyEquipmentModule, FireBrigadeModule],
  controllers: [DashboardController],
  providers: [DashboardService, WeeklyDigestService],
  exports: [DashboardService],
})
export class DashboardModule {}
