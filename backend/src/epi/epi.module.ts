import { Module } from '@nestjs/common';
import { EpiCatalogController } from './epi-catalog.controller';
import { EpisController } from './epis.controller';
import { EpiService } from './epi.service';

@Module({
  controllers: [EpiCatalogController, EpisController],
  providers: [EpiService],
})
export class EpiModule {}
