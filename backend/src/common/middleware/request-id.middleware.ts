import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

// Roda antes de guards/interceptors — assim o request_id já existe pra
// correlacionar o log de request (RequestLoggingInterceptor) com o log de
// erro (AllExceptionsFilter), mesmo quando o erro acontece antes do
// interceptor terminar.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
