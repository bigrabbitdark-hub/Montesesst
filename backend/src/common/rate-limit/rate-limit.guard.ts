import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { envInt } from '../env';
import { JsonLoggerService } from '../logging/json-logger.service';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY, RateLimitOptions, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';

// Limite degradado usado quando o Redis está offline (F-22). Em produção,
// isso é o teto aceitável para um único IP em um intervalo de 60s até que
// o Redis volte — bem mais restritivo que o limite global padrão (300/5min)
// porque roda numa única réplica e não distribuído.
const LOCAL_FALLBACK_LIMIT = 60;
const LOCAL_FALLBACK_WINDOW_MS = 60_000;
const LOCAL_FALLBACK_SWEEP_INTERVAL = 1000;

// Global (registrado como APP_GUARD em AppModule). Roda antes de qualquer
// guard de autenticação — inclusive tentativa de login precisa ser
// limitada, e nesse ponto ainda não existe request.user. Ver
// docs/operations/reliability.md.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly logger: JsonLoggerService,
  ) {}

  // Fallback local em memória, por (rota, ip). Vazio quando Redis está
  // saudável — o Redis é a fonte da verdade. Sweep periódico para não
  // vazar memória em processos longos (PM2/Docker restart=unless-stopped).
  private readonly localBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private cleanupCounter = 0;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const custom = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const options: RateLimitOptions = custom ?? {
      limit: envInt('RATE_LIMIT_MAX', 300),
      windowSeconds: envInt('RATE_LIMIT_WINDOW_SECONDS', 300),
      keyBy: 'ip',
    };

    const request = context.switchToHttp().getRequest();
    const ip = request.ip ?? 'unknown';
    // Rotas com @RateLimit(...) próprio (ex: /auth/login, /auth/register)
    // usam um contador isolado por rota — sem isso, duas rotas com limites
    // diferentes (ex: 10/15min no login vs 5/hora no cadastro) dividiriam o
    // mesmo contador Redis, e o limite mais apertado seria consumido por
    // tráfego de outra rota qualquer do mesmo IP. Só a rota SEM decorator
    // (limite global genérico) usa o contador compartilhado "global".
    const routeScope = custom ? `${context.getClass().name}.${context.getHandler().name}` : 'global';
    const key =
      options.keyBy === 'ip-email'
        ? `ratelimit:${routeScope}:${ip}:${String(request.body?.email ?? '').toLowerCase()}`
        : `ratelimit:${routeScope}:${ip}`;

    // Falha do Redis não pode derrubar a aplicação inteira nem bloquear
    // login legítimo. Em vez de fail-open silencioso (que permitiria a
    // um atacante derrubar o Redis e depois martelar a API), caímos num
    // fallback local em memória bem mais restritivo e logamos o evento
    // para acionar alerta no Sentry/Datadog. Ver F-22 no
    // docs/audits/security-audit-preprod.md.
    try {
      const result = await this.redis.incrementWithWindow(
        key,
        options.windowSeconds,
      );
      if (result.count > options.limit) {
        const response = context.switchToHttp().getResponse();
        response.setHeader('Retry-After', Math.ceil(result.ttlMs / 1000));
        throw new HttpException(
          'Muitas requisições, tente novamente mais tarde',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      // Re-throw de HttpException do caminho Redis (429 acima).
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `rate-limit redis offline — fallback local ${LOCAL_FALLBACK_LIMIT}/60s/ip. ` +
          `route=${routeScope} ip=${ip} err=${(err as Error).message}`,
      );
      return this.localFallback(key);
    }
  }

  // Fallback em memória: incrementa bucket pelo mesmo `key` que seria usado
  // no Redis (inclui e-mail quando keyBy='ip-email', preservando o isolamento
  // entre contas no mesmo IP) e joga 429 se ultrapassar LOCAL_FALLBACK_LIMIT.
  // Sweep inline a cada LOCAL_FALLBACK_SWEEP_INTERVAL chamadas para não
  // deixar entry órfã.
  private localFallback(key: string): boolean {
    const now = Date.now();
    const bucket = this.localBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.localBuckets.set(key, {
        count: 1,
        resetAt: now + LOCAL_FALLBACK_WINDOW_MS,
      });
    } else {
      bucket.count += 1;
    }
    const current = this.localBuckets.get(key)!;

    if (++this.cleanupCounter >= LOCAL_FALLBACK_SWEEP_INTERVAL) {
      this.cleanupCounter = 0;
      for (const [k, b] of this.localBuckets) {
        if (now >= b.resetAt) this.localBuckets.delete(k);
      }
    }

    if (current.count > LOCAL_FALLBACK_LIMIT) {
      throw new HttpException(
        'Muitas requisições, tente novamente mais tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
