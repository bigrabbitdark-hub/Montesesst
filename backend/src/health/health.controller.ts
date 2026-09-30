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
    // ITEM 009 (auditoria do Assistente, 2026-09-28): SHA do commit que
    // builda esta imagem (ver backend/Dockerfile), pra comparar "o que
    // está rodando" com `git rev-parse HEAD` sem precisar entrar no
    // container. "unknown" quando ninguém passou --build-arg GIT_COMMIT —
    // nunca bloqueia o healthcheck.
    return { status: 'ok', db_time: result.rows[0].now, commit: process.env.GIT_COMMIT ?? 'unknown' };
  }
}
