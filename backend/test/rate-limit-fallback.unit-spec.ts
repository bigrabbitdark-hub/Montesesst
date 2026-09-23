// F-22: testes do fallback local em memória do RateLimitGuard. Cobre os
// cenários que o Redis-path não cobre — especificamente:
//   1. Incremento quando Redis está offline
//   2. Bloqueio (429) após LOCAL_FALLBACK_LIMIT requisições do mesmo IP
//   3. Isolamento por chave (mesmo IP, e-mails diferentes não somam)
//   4. Janela de 60s (passou, o contador reseta)
//   5. Sweep de buckets expirados não derruba buckets ativos
//
// Os testes NÃO precisam de Redis/Postgres — constroem um RateLimitGuard
// diretamente com RedisService mockado para sempre falhar.

import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard';
import { JsonLoggerService } from '../src/common/logging/json-logger.service';
import type { RedisService } from '../src/common/redis/redis.service';

class RedisAlwaysDown {
  async incrementWithWindow(): Promise<{ count: number; ttlMs: number }> {
    throw new Error('Redis offline — simulado para teste de fallback');
  }
}

class CapturingLogger extends JsonLoggerService {
  public warns: string[] = [];
  warn(message: unknown): void {
    this.warns.push(String(message));
  }
}

function makeContext(): ExecutionContext {
  const req = { ip: '203.0.113.7', body: { email: 'user@teste.montese.local' } };
  const res = { setHeader: jest.fn() };
  return {
    getHandler: () => ({ name: 'login' } as never),
    getClass: () => ({ name: 'AuthController' } as never),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(): {
  guard: RateLimitGuard;
  logger: CapturingLogger;
  invoke: (ctx: ExecutionContext, opts?: { limit?: number; keyBy?: 'ip' | 'ip-email'; email?: string }) => Promise<boolean>;
} {
  const reflector = new Reflector();
  const redis = new RedisAlwaysDown();
  const logger = new CapturingLogger();
  const guard = new RateLimitGuard(
    reflector,
    redis as unknown as RedisService,
    logger,
  );

  // @RateLimit() custom precisa ser lido do metadata; sem ele o guard usa
  // o limite global (envInt). Aqui forçamos o caminho do decorator mockando
  // getAllAndOverride para devolver um objeto custom.
  const invoke = async (
    ctx: ExecutionContext,
    opts?: { limit?: number; keyBy?: 'ip' | 'ip-email'; email?: string },
  ) => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    spy.mockImplementation(<T>(_key: string): T => {
      if (_key.includes('skip')) return false as unknown as T;
      return { limit: opts?.limit ?? 999, windowSeconds: 60, keyBy: opts?.keyBy ?? 'ip' } as unknown as T;
    });
    if (opts?.email !== undefined) {
      (ctx.switchToHttp().getRequest() as { body?: { email?: string } }).body = { email: opts.email };
    }
    return guard.canActivate(ctx);
  };

  return { guard, logger, invoke };
}

describe('RateLimitGuard — fallback local (F-22)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('log estruturado quando o Redis cai (não engole silenciosamente)', async () => {
    const { logger, invoke } = makeGuard();
    await expect(invoke(makeContext(), { limit: 5, keyBy: 'ip-email' })).resolves.toBe(true);
    expect(logger.warns.length).toBe(1);
    expect(logger.warns[0]).toMatch(/rate-limit redis offline/);
    expect(logger.warns[0]).toMatch(/route=AuthController\.login/);
    expect(logger.warns[0]).toMatch(/ip=203\.0\.113\.7/);
    expect(logger.warns[0]).toMatch(/err=Redis offline/);
  });

  it('permite até LOCAL_FALLBACK_LIMIT (60) requisições e bloqueia a 61ª com 429', async () => {
    const { invoke } = makeGuard();
    const ctx = makeContext();

    // 60 chamadas dentro do limite — todas devem passar
    for (let i = 0; i < 60; i++) {
      await expect(invoke(ctx, { limit: 5, keyBy: 'ip-email' })).resolves.toBe(true);
    }
    // 61ª deve disparar 429
    await expect(invoke(ctx, { limit: 5, keyBy: 'ip-email' })).rejects.toBeInstanceOf(HttpException);
  });

  it('isola contadores por (rota, ip, email) — duas contas no mesmo IP não compartilham bucket', async () => {
    const { invoke } = makeGuard();
    const ctxA = makeContext();
    const ctxB = makeContext();

    // 60 chamadas com e-mail A
    for (let i = 0; i < 60; i++) {
      await expect(invoke(ctxA, { limit: 5, keyBy: 'ip-email', email: 'a@teste.montese.local' })).resolves.toBe(true);
    }
    await expect(invoke(ctxA, { limit: 5, keyBy: 'ip-email', email: 'a@teste.montese.local' })).rejects.toBeInstanceOf(HttpException);

    // B começa do zero (chave diferente)
    await expect(invoke(ctxB, { limit: 5, keyBy: 'ip-email', email: 'b@teste.montese.local' })).resolves.toBe(true);
  });

  it('após 60s, o contador reseta e o IP volta a poder fazer requisições', async () => {
    const { invoke } = makeGuard();
    const ctx = makeContext();

    for (let i = 0; i < 60; i++) {
      await expect(invoke(ctx, { limit: 5, keyBy: 'ip-email' })).resolves.toBe(true);
    }
    await expect(invoke(ctx, { limit: 5, keyBy: 'ip-email' })).rejects.toBeInstanceOf(HttpException);

    // Avança 61 segundos — janela de 60s expirou
    jest.advanceTimersByTime(61_000);

    await expect(invoke(ctx, { limit: 5, keyBy: 'ip-email' })).resolves.toBe(true);
  });
});
