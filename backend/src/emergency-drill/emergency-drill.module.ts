import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsModule } from '../prevention-corrective-actions/prevention-corrective-actions.module';
import { EmergencyDrillController } from './emergency-drill.controller';
import { EmergencyDrillService } from './emergency-drill.service';

@Module({
  imports: [PreventionCorrectiveActionsModule],
  controllers: [EmergencyDrillController],
  providers: [EmergencyDrillService],
  exports: [EmergencyDrillService],
})
export class EmergencyDrillModule {}
