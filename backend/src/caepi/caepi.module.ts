import { Module } from '@nestjs/common';
import { CaepiController } from './caepi.controller';
import { CaepiService } from './caepi.service';

@Module({
  controllers: [CaepiController],
  providers: [CaepiService],
})
export class CaepiModule {}
