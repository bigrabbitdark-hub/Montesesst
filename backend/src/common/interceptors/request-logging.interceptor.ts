import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

// Uma linha JSON por request, sempre — diferente do AuditInterceptor (que só
// grava mutações no audit_log pra trilha de compliance), este cobre 100% do
// tráfego pra debugging operacional (docs/operations/reliability.md).
// Escreve direto em stdout (não via Logger do Nest) porque o formato é
// estruturado por natureza — não é uma "mensagem com contexto opcional".
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logRequest(context, request, start, context.switchToHttp().getResponse().statusCode),
        // No caminho de erro, response.statusCode ainda não reflete o status
        // final (o Nest pré-preenche um status de sucesso antes de rodar o
        // handler, e só o AllExceptionsFilter — que roda depois deste
        // interceptor na cadeia — corrige pra 401/403/429/500 etc). Por
        // isso o status aqui vem do próprio erro, não do response.
        error: (err) =>
          this.logRequest(
            context,
            request,
            start,
            err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      }),
    );
  }

  private logRequest(context: ExecutionContext, request: any, start: number, statusCode: number) {
    const line = {
      timestamp: new Date().toISOString(),
      level: 'log',
      context: 'HTTP',
      request_id: request.id,
      method: request.method,
      path: request.originalUrl ?? request.url,
      status_code: statusCode,
      duration_ms: Date.now() - start,
      tenant_id: request.user?.tenantId ?? null,
      user_id: request.user?.id ?? null,
      ip: request.ip,
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  }
}
