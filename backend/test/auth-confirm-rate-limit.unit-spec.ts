/**
 * Cobre F-17 do audit pré-prod (`/auth/confirm` sem rate-limit).
 *
 * Valida que o handler `confirm` do AuthController está marcado com o
 * decorator `@RateLimit` correto: limit=30, windowSeconds=3600, keyBy='ip'
 * (defaults; overridable via env AUTH_CONFIRM_RATE_LIMIT_*).
 *
 * Roda SEM infra externa (sem Postgres/Redis), em jest-unit.json — usa
 * `Reflector.get()` direto na metadata que o decorator `RateLimit` aplica
 * via SetMetadata(RATE_LIMIT_KEY, options).
 */

import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../src/auth/auth.controller';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../src/common/rate-limit/rate-limit.decorator';

describe('AuthController.confirm — rate-limit (F-17)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('handler confirm tem metadata rate-limit aplicada com defaults 30/3600/ip', () => {
    delete process.env.AUTH_CONFIRM_RATE_LIMIT_MAX;
    delete process.env.AUTH_CONFIRM_RATE_LIMIT_WINDOW_SECONDS;
    const reflector = new Reflector();

    const opts = reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      AuthController.prototype.confirm,
    );

    expect(opts).toBeDefined();
    expect(opts).toEqual({
      limit: 30,
      windowSeconds: 3600,
      keyBy: 'ip',
    });
  });

  it('env override AUTH_CONFIRM_RATE_LIMIT_MAX=10 é refletido no metadata', () => {
    // O decorator é avaliado no momento do import do módulo — então setar
    // a env ANTES de carregar o AuthController simula o cenário real de
    // produção com env customizada.
    process.env.AUTH_CONFIRM_RATE_LIMIT_MAX = '10';
    process.env.AUTH_CONFIRM_RATE_LIMIT_WINDOW_SECONDS = '600';

    // Recarrega AuthController com a nova env.
    let opts: RateLimitOptions | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../src/auth/auth.controller');
      const Controller = mod.AuthController;
      const reflector = new Reflector();
      opts = reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, Controller.prototype.confirm);
    });

    expect(opts).toBeDefined();
    expect(opts).toEqual({
      limit: 10,
      windowSeconds: 600,
      keyBy: 'ip',
    });
  });
});
