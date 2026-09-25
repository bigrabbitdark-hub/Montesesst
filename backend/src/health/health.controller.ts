import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';

@Public()
@RateLimit({
  limit: envInt('HEALTH_RATE_LIMIT_MAX', 600),
  windowSeconds: envInt('HEALTH_RATE_LIMIT_WINDOW_SECONDS', 60),
  keyBy: 'ip',
})
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check() {
    const result = await this.db.withoutTenantContext((client) => client.query('SELECT now()'));
    return { status: 'ok', db_time: result.rows[0].now };
  }
}
