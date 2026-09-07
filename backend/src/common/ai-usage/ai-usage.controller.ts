import { Controller, Get } from '@nestjs/common';
import { Roles } from '../decorators/roles.decorator';
import { AiUsageLogService } from './ai-usage-log.service';

@Controller('admin/ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageLogService) {}

  @Roles('admin')
  @Get()
  getSummary() {
    return this.usage.getSummary();
  }
}
