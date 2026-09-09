import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsController } from './prevention-corrective-actions.controller';
import { PreventionCorrectiveActionsService } from './prevention-corrective-actions.service';

@Module({
  controllers: [PreventionCorrectiveActionsController],
  providers: [PreventionCorrectiveActionsService],
  exports: [PreventionCorrectiveActionsService],
})
export class PreventionCorrectiveActionsModule {}
