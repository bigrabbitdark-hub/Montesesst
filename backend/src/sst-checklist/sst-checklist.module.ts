import { Module } from '@nestjs/common';
import { SstChecklistService } from './sst-checklist.service';
import { SstChecklistController } from './sst-checklist.controller';

@Module({
  controllers: [SstChecklistController],
  providers: [SstChecklistService],
})
export class SstChecklistModule {}
