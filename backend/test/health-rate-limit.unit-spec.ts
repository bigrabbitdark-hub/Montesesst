/**
 * Cobre F-16 do audit pré-prod (`/health` público sem rate-limit).
 *
 * Valida que o handler `check` do HealthController:
 *  1. Está marcado com `@RateLimit` (não mais `@SkipRateLimit()`).
 *  2. Tem metadata com defaults 600/60/ip (generoso para load balancer
 *     e monitoring, mas bloqueia varredura abusiva).
 *  3. NÃO tem metadata SKIP_RATE_LIMIT_KEY (regressão: PR 2 adicionou
 *     @SkipRateLimit; PR 4 restaura rate-limit no /health).
 *
 * IMPORTANTE: `@RateLimit` está aplicada **no nível da classe** (não no
 * handler `check`), exatamente como em produção. Por isso o teste espelha
 * o guard real (`reflector.getAllAndOverride(KEY, [handler, class])`):
 * `Reflect.getMetadata(KEY, prototype.check)` retorna `undefined` porque
 * não sobe automaticamente pra classe — só funciona passar a classe como
 * target, ou iterar nos dois via `getAllAndOverride`. Espelhar o padrão do
 * guard mantém o teste realista caso alguém mova o decorator.
 *
 * Roda SEM infra externa (sem Postgres/Redis), em jest-unit.json.
 */

import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
  SKIP_RATE_LIMIT_KEY,
} from '../src/common/rate-limit/rate-limit.decorator';

describe('HealthController.check — rate-limit (F-16)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // Lê metadata exatamente como o RateLimitGuard faz em produção:
  // [handler, classe]. Se algum dia o decorator for movido pra um método
  // específico, o teste continua funcionando.
  const readMetadata = <T>(
    reflector: Reflector,
    key: string,
    Controller: Function,
  ): T | undefined =>
    reflector.getAllAndOverride<T>(key, [
      Controller.prototype.check,
      Controller,
    ]);

  it('handler check tem metadata rate-limit aplicada com defaults 600/60/ip', () => {
    delete process.env.HEALTH_RATE_LIMIT_MAX;
    delete process.env.HEALTH_RATE_LIMIT_WINDOW_SECONDS;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HealthController } = require('../src/health/health.controller');
    const reflector = new Reflector();

    const opts = readMetadata<RateLimitOptions>(reflector, RATE_LIMIT_KEY, HealthController);

    expect(opts).toBeDefined();
    expect(opts).toEqual({
      limit: 600,
      windowSeconds: 60,
      keyBy: 'ip',
    });
  });

  it('handler check NÃO tem metadata SKIP_RATE_LIMIT_KEY (regressão)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HealthController } = require('../src/health/health.controller');
    const reflector = new Reflector();

    const skip = readMetadata<boolean>(reflector, SKIP_RATE_LIMIT_KEY, HealthController);

    expect(skip).toBeFalsy();
  });

  it('env override HEALTH_RATE_LIMIT_MAX=120 é refletido no metadata', () => {
    process.env.HEALTH_RATE_LIMIT_MAX = '120';
    process.env.HEALTH_RATE_LIMIT_WINDOW_SECONDS = '30';

    let opts: RateLimitOptions | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../src/health/health.controller');
      const Controller = mod.HealthController;
      const reflector = new Reflector();
      opts = readMetadata<RateLimitOptions>(reflector, RATE_LIMIT_KEY, Controller);
    });

    expect(opts).toBeDefined();
    expect(opts).toEqual({
      limit: 120,
      windowSeconds: 30,
      keyBy: 'ip',
    });
  });
});
