import { Module } from '@nestjs/common';
import { EpiCatalogController } from './epi-catalog.controller';
import { EpisController } from './epis.controller';
import { EpiService } from './epi.service';
import { EpiStockService } from './epi-stock.service';
import { EpiDashboardService } from './epi-dashboard.service';

@Module({
  controllers: [EpiCatalogController, EpisController],
  providers: [EpiService, EpiStockService, EpiDashboardService],
})
export class EpiModule {}
