import { Module } from '@nestjs/common';
import { AsoController } from './aso.controller';
import { AsoService } from './aso.service';

@Module({
  controllers: [AsoController],
  providers: [AsoService],
  exports: [AsoService],
})
export class AsoModule {}
