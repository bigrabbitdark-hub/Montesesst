import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SystemStatusService } from './system-status.service';

@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly systemStatus: SystemStatusService) {}

  @Roles('admin')
  @Get()
  getStatus() {
    return this.systemStatus.getStatus();
  }
}
