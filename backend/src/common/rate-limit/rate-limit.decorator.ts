import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  // 'ip' (padrão): limita por IP, cobre a rota inteira.
  // 'ip-email': limita por IP + e-mail do corpo da requisição — usado em
  // /auth/login pra impedir força bruta numa conta específica sem punir
  // outros usuários atrás do mesmo IP (ex: NAT de escritório).
  keyBy?: 'ip' | 'ip-email';
}

export const RATE_LIMIT_KEY = 'rateLimitOptions';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
