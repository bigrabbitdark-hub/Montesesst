import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { envInt } from '../env';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY, RateLimitOptions, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';

// Global (registrado como APP_GUARD em AppModule). Roda antes de qualquer
// guard de autenticação — inclusive tentativa de login precisa ser
// limitada, e nesse ponto ainda não existe request.user. Ver
// docs/operations/reliability.md.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

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
    const key =
      options.keyBy === 'ip-email'
        ? `ratelimit:auth:${ip}:${String(request.body?.email ?? '').toLowerCase()}`
        : `ratelimit:global:${ip}`;

    // Falha do Redis não pode derrubar a aplicação inteira nem bloquear
    // login legítimo — se o contador falhar, deixa passar e loga o erro
    // (RedisService já loga a conexão; aqui só garantimos fail-open).
    let result: { count: number; ttlMs: number };
    try {
      result = await this.redis.incrementWithWindow(key, options.windowSeconds);
    } catch {
      return true;
    }

    if (result.count > options.limit) {
      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', Math.ceil(result.ttlMs / 1000));
      throw new HttpException(
        'Muitas requisições, tente novamente mais tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
