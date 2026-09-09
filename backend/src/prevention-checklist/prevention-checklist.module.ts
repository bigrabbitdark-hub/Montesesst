import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsModule } from '../prevention-corrective-actions/prevention-corrective-actions.module';
import { PreventionChecklistController } from './prevention-checklist.controller';
import { PreventionChecklistService } from './prevention-checklist.service';

@Module({
  imports: [PreventionCorrectiveActionsModule],
  controllers: [PreventionChecklistController],
  providers: [PreventionChecklistService],
  exports: [PreventionChecklistService],
})
export class PreventionChecklistModule {}
