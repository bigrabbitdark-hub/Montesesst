import { Module } from '@nestjs/common';
import { EpiFichaController } from './epi-ficha.controller';
import { EpiFichaService } from './epi-ficha.service';

@Module({
  controllers: [EpiFichaController],
  providers: [EpiFichaService],
  exports: [EpiFichaService],
})
export class EpiFichaModule {}
