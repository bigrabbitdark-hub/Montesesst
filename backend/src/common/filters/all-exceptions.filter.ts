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
// Erros 4xx que NÃO são HttpException do Nest mas são culpa do cliente:
// - MulterError (upload): o Nest 10 os converte comparando o TEXTO da mensagem, que o multer
//   já mudou entre versões (ex.: "Unexpected field" -> "Unexpected file field") e ganhou
//   códigos novos; mapear pelo `code` não depende do texto.
// - erros do tipo http-errors (body-parser: corpo grande demais, JSON inválido...), que trazem
//   `status` 4xx e `expose: true`.
// - falha de descompressão do corpo (zlib: Z_DATA_ERROR etc.).
export function clientErrorStatus(exception: unknown): number | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const e = exception as { name?: string; code?: unknown; status?: unknown; statusCode?: unknown; expose?: unknown };
  if (e.name === 'MulterError') {
    return e.code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
  }
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (e.expose === true && status !== undefined && status >= 400 && status < 500) return status;
  if (typeof e.code === 'string' && e.code.startsWith('Z_')) return HttpStatus.BAD_REQUEST;
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const inputErrorStatus = isHttpException ? null : clientErrorStatus(exception);
    const statusCode = isHttpException
      ? exception.getStatus()
      : (inputErrorStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const body = isHttpException
      ? exception.getResponse()
      : inputErrorStatus
        ? { statusCode, message: inputErrorStatus === 413 ? 'Conteúdo grande demais' : 'Requisição inválida' }
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
