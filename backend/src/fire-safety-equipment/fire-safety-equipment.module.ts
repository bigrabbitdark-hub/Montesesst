import { Module } from '@nestjs/common';
import { FireSafetyEquipmentController } from './fire-safety-equipment.controller';
import { FireSafetyEquipmentService } from './fire-safety-equipment.service';

@Module({
  controllers: [FireSafetyEquipmentController],
  providers: [FireSafetyEquipmentService],
  exports: [FireSafetyEquipmentService],
})
export class FireSafetyEquipmentModule {}
