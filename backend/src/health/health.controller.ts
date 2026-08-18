import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipRateLimit } from '../common/rate-limit/rate-limit.decorator';

@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check() {
    const result = await this.db.withoutTenantContext((client) => client.query('SELECT now()'));
    return { status: 'ok', db_time: result.rows[0].now };
  }
}
