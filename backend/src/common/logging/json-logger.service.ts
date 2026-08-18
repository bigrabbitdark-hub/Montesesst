import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';

// Substitui o logger padrão do Nest (texto colorido) por linhas JSON —
// docker logs vira algo grepável/parseável em vez de texto solto. Ver
// docs/operations/reliability.md (frente de observabilidade da spec de
// Escala/Auditoria/Confiabilidade).
export class JsonLoggerService extends ConsoleLogger implements LoggerService {
  private write(level: LogLevel, message: unknown, meta?: Record<string, unknown>) {
    const line = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...meta,
    };
    const out = level === 'error' ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('log', message, { context });
  }

  error(message: unknown, stack?: string, context?: string) {
    this.write('error', message, { context, stack });
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, { context });
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, { context });
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, { context });
  }
}
