import { Global, Module } from '@nestjs/common';
import { AiUsageLogService } from './ai-usage-log.service';
import { AiUsageController } from './ai-usage.controller';

@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageLogService],
  exports: [AiUsageLogService],
})
export class AiUsageModule {}
