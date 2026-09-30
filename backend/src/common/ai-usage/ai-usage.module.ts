import { Global, Module } from '@nestjs/common';
import { AiUsageLogService } from './ai-usage-log.service';
import { AiUsageController } from './ai-usage.controller';
import { OpenRouterCreditMonitorCronService } from './openrouter-credit-monitor.cron';

@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageLogService, OpenRouterCreditMonitorCronService],
  exports: [AiUsageLogService, OpenRouterCreditMonitorCronService],
})
export class AiUsageModule {}
