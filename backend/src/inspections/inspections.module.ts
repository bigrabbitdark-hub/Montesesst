import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { ActionPlansController } from './action-plans.controller';
import { InspectionsService } from './inspections.service';

@Module({
  controllers: [InspectionsController, ActionPlansController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
