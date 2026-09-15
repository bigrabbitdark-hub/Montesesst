import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { ActionPlansController } from './action-plans.controller';
import { InspectionsService } from './inspections.service';
import { AiCopilotModule } from '../ai-copilot/ai-copilot.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [AiCopilotModule, DocumentsModule],
  controllers: [InspectionsController, ActionPlansController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
