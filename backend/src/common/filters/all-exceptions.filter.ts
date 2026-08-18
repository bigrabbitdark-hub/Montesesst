import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

// Captura qualquer erro não tratado, loga em JSON com stack trace (pra
// investigar depois via docker logs) e devolve uma resposta genérica ao
// cliente — nunca o stack trace ou detalhe interno, mesmo em erro 500.
// Erros HTTP esperados (400, 401, 403, 404...) preservam a resposta normal
// do Nest, só passam pelo mesmo log estruturado.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException
      ? exception.getResponse()
      : { statusCode, message: 'Erro interno' };

    // 4xx é rejeição esperada do cliente (senha errada, 404, rate limit) —
    // "warn" sem barulho de stack trace. 5xx é bug real e merece "error" +
    // stack completo, senão ele se perde no meio de todo 401 de login.
    const isClientError = statusCode >= 400 && statusCode < 500;
    const line = {
      timestamp: new Date().toISOString(),
      level: isClientError ? 'warn' : 'error',
      context: 'ExceptionFilter',
      request_id: request?.id,
      method: request?.method,
      path: request?.originalUrl ?? request?.url,
      status_code: statusCode,
      message: exception instanceof Error ? exception.message : String(exception),
      stack: isClientError ? undefined : exception instanceof Error ? exception.stack : undefined,
    };
    process.stderr.write(JSON.stringify(line) + '\n');

    response.status(statusCode).json(
      typeof body === 'string' ? { statusCode, message: body } : body,
    );
  }
}
