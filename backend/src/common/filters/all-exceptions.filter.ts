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
// Troca TODA corrida de 9+ dígitos (até 8 separadores entre eles) por [NUM]: CPF, matrícula, telefone... nunca vão ao log.
const NUM_RUN = /\p{Nd}(?:[^\p{L}\p{N}]{0,8}\p{Nd}){8,}/gu;
export const redactNums = (s: string): string => s.replace(NUM_RUN, '[NUM]');

const OMITTED = '[omitido]';
// Identificadores (nome do erro, code, routine, função, schema/table/column/constraint): só caracteres de identificador.
const SAFE_ID = /^[A-Za-z0-9_$.:-]{1,64}$/;
const safeId = (v: unknown): string | undefined => (typeof v !== 'string' || v === '' ? undefined : SAFE_ID.test(v) ? v : OMITTED);
// Qualquer leitura de propriedade pode lançar (getter hostil, Proxy): nunca propaga.
const get = (e: unknown, key: string): unknown => {
  try {
    return e === null || e === undefined ? undefined : (e as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};
const safeString = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : String(v);
  } catch {
    return '[ilegível]';
  }
};
const isInstance = (e: unknown, c: abstract new (...a: never[]) => unknown): boolean => {
  try {
    return e instanceof c;
  } catch {
    return false;
  }
};

// Mensagens de erros de programação que liberamos: só estas formas exatas, sem valores nem texto livre.
const PROGRAMMING_MSG = [/^Cannot read properties of (?:undefined|null) \(reading '[\w$]+'\)$/, /^[\w$.]+ is not a function$/];
// Frames aceitos: `at fn (/caminho:l:c)`, `at /caminho:l:c`, `at node:...:l:c`.
const FRAME_PATH = String.raw`(?:\/|node:|file:\/\/\/)[A-Za-z0-9_$@.\/+~-]*:\d+:\d+`;
const FRAME_WITH_FN = new RegExp(String.raw`^\s+at (?:(async|new) )?([^\s()]+(?: \[as [A-Za-z0-9_$]+\])?) \((${FRAME_PATH})\)$`);
const FRAME_BARE = new RegExp(String.raw`^\s+at (${FRAME_PATH})$`);
const MAX_STACK_CHARS = 20000;

// Linhas "at ..." sem as primeiras N (a message ocupa N linhas da stack) e só no formato esperado.
function safeFrames(stack: string, messageLines: number): string[] {
  const frames: string[] = [];
  const lines = stack.slice(0, MAX_STACK_CHARS).split('\n').slice(Math.max(1, messageLines));
  for (const l of lines) {
    let m = FRAME_WITH_FN.exec(l);
    if (m) {
      const fn = SAFE_ID.test(m[2].replace(/ \[as [A-Za-z0-9_$]+\]$/, '').replace(/<(anonymous)>/g, '$1')) ? m[2] : OMITTED;
      frames.push(`at ${m[1] ? m[1] + ' ' : ''}${fn} (${m[3]})`);
    } else if ((m = FRAME_BARE.exec(l))) frames.push(`at ${m[1]}`);
    if (frames.length >= 20) break;
  }
  return frames;
}

const PG_CODE = /^[0-9A-Z]{5}$/;
// Campos de log de um erro. Regra: erro 5xx ou com `code` de texto (erros do pg) NUNCA registra `message` nem os campos
// do pg que carregam dados (detail, where, hint, query, parameters): o erro de jsonb do Postgres, por exemplo, traz no
// `where` o JSON inteiro da linha (CPF, nome). Só name/code/routine (e, no pg, schema/table/column/constraint se forem
// identificadores) e as linhas "at ..." da stack (sem as linhas da message), saneadas. HttpException (mensagem estática
// escrita por nós) mantém a message, só com a troca de 9+ dígitos. 4xx preserva o log de antes (message, sem stack).
export function exceptionLogFields(exception: unknown, statusCode: number, isHttp: boolean): Record<string, unknown> {
  const isClientError = statusCode >= 400 && statusCode < 500;
  const isError = isInstance(exception, Error);
  const fields: Record<string, unknown> = {};
  const rawMessage = isError ? get(exception, 'message') : undefined;
  if (isClientError) {
    fields.message = redactNums(isError ? safeString(rawMessage) : safeString(exception)).slice(0, 300);
    return fields;
  }
  fields.error_name = safeId(get(exception, 'name')) ?? (isError ? 'Error' : typeof exception);
  const rawCode = get(exception, 'code');
  const code = safeId(rawCode);
  if (code) fields.error_code = code;
  const routine = safeId(get(exception, 'routine'));
  if (routine) fields.error_routine = routine;
  const isPg = typeof rawCode === 'string' && PG_CODE.test(rawCode);
  if (isPg) {
    for (const k of ['schema', 'table', 'column', 'constraint']) {
      const v = get(exception, k);
      if (typeof v === 'string' && SAFE_ID.test(v)) fields[`error_${k}`] = v;
    }
  }
  if (isHttp && !code && isError) fields.message = redactNums(safeString(rawMessage)).slice(0, 300);
  else if (isError && !code && typeof rawMessage === 'string' && /^(?:Type|Reference|Range)Error$/.test(String(fields.error_name)) && PROGRAMMING_MSG.some((r) => r.test(rawMessage))) {
    fields.message = redactNums(rawMessage);
  }
  const stack = isError ? get(exception, 'stack') : undefined;
  if (typeof stack === 'string') {
    const msgLines = typeof rawMessage === 'string' ? rawMessage.split('\n').length : 1;
    const frames = safeFrames(stack, msgLines);
    if (frames.length) {
      fields.stack = redactNums(frames.join('\n'));
      // Primeiro frame da aplicação (fora de node_modules/node:): é onde o erro foi tratado, mesmo quando nasceu no pg.
      const at = frames.find((f) => !f.includes('node_modules') && !f.includes('node:')) ?? frames[0];
      fields.error_at = redactNums(at).slice(0, 300);
    }
  }
  return fields;
}

const pathOf = (request: unknown): string | undefined => {
  const raw = get(request, 'originalUrl') ?? get(request, 'url');
  return typeof raw === 'string' ? redactNums(raw.split(/[?#]/, 1)[0]).slice(0, 200) : undefined;
};
const strOf = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

// Captura qualquer erro não tratado, loga em JSON (pra investigar depois via docker logs) e devolve uma resposta
// genérica ao cliente — nunca o stack trace ou detalhe interno, mesmo em erro 500. Erros HTTP esperados (400, 401, 403,
// 404...) preservam a resposta normal do Nest, só passam pelo mesmo log estruturado. O log nunca recebe dados do banco
// nem do usuário (ver exceptionLogFields).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // A resposta HTTP não depende do log: o status/corpo são calculados à parte e SEMPRE enviados.
    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown = { statusCode, message: 'Erro interno' };
    let isHttpException = false;
    try {
      if (exception instanceof HttpException) {
        isHttpException = true;
        statusCode = exception.getStatus();
        body = exception.getResponse();
      }
    } catch {
      isHttpException = false;
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { statusCode, message: 'Erro interno' };
    }

    // 4xx é rejeição esperada do cliente (senha errada, 404, rate limit) — "warn". 5xx é bug real e merece "error".
    const isClientError = statusCode >= 400 && statusCode < 500;
    try {
      const line = {
        timestamp: new Date().toISOString(),
        level: isClientError ? 'warn' : 'error',
        context: 'ExceptionFilter',
        request_id: strOf(get(request, 'id'), 64),
        method: safeId(get(request, 'method')),
        path: pathOf(request),
        status_code: statusCode,
        ...exceptionLogFields(exception, statusCode, isHttpException),
      };
      process.stderr.write(JSON.stringify(line) + '\n');
    } catch {
      try {
        process.stderr.write(JSON.stringify({ level: 'error', context: 'ExceptionFilter', status_code: statusCode, error_name: OMITTED }) + '\n');
      } catch {
        // o log nunca derruba a resposta
      }
    }

    response.status(statusCode).json(
      typeof body === 'string' ? { statusCode, message: body } : body,
    );
  }
}
