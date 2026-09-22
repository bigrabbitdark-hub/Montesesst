// Argumentos dos comandos eval:* (Etapas 2 e 3 da Confiabilidade do
// Assistente). Módulo puro: sem I/O.
export const DEFAULT_MAX_LLM_CALLS = 15;
const DEFAULT_USAGE_DAYS = 30;

export interface EvalArgs {
  tipos: string[];
  ids: string[];
  out: string | null;
  compare: string | null;
  file: string | null;
  grep: string | null;
  llm: boolean;
  maxLlmCalls: number;
  allowFull: boolean;
  failOnRegression: boolean;
  write: boolean;
  days: number;
  positional: string[];
}

const BOOLEAN_FLAGS = new Set(['--llm', '--allow-full', '--fail-on-regression', '--write']);
const VALUE_FLAGS = new Set(['--tipo', '--ids', '--out', '--compare', '--file', '--grep', '--max-llm-calls', '--days']);

// Só inteiro decimal puro ("15", "007"): Number() aceitaria "1e3", "0x10",
// "0b11", "+5" e " 7 ", e um teto de chamadas PAGAS não pode ser frouxo assim.
const DECIMAL_INTEGER = /^\d+$/;

function parsePositiveInt(flag: string, raw: string): number {
  const value = DECIMAL_INTEGER.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} exige um inteiro positivo (recebido "${raw}")`);
  }
  return value;
}

// Teto de chamadas pagas ao LLM (spec §5.3): acima do padrão, só com
// --allow-full explícito. Recusa, em vez de limitar em silêncio, para quem
// pediu 60 não achar que rodou 60. Exportada porque planLlmRun repete a
// checagem: ela recebe EvalArgs que podem não ter passado por parseEvalArgs.
export function assertLlmCallLimit(maxLlmCalls: number, allowFull: boolean): void {
  if (!Number.isSafeInteger(maxLlmCalls) || maxLlmCalls < 1) {
    throw new Error(`--max-llm-calls exige um inteiro positivo (recebido "${maxLlmCalls}")`);
  }
  if (!allowFull && maxLlmCalls > DEFAULT_MAX_LLM_CALLS) {
    throw new Error(
      `--max-llm-calls acima de ${DEFAULT_MAX_LLM_CALLS} exige --allow-full (recebido ${maxLlmCalls}): a Camada B chama o LLM real e PAGO`,
    );
  }
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function parseEvalArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    tipos: [],
    ids: [],
    out: null,
    compare: null,
    file: null,
    grep: null,
    llm: false,
    maxLlmCalls: DEFAULT_MAX_LLM_CALLS,
    allowFull: false,
    failOnRegression: false,
    write: false,
    days: DEFAULT_USAGE_DAYS,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.positional.push(token);
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--llm') args.llm = true;
      if (token === '--allow-full') args.allowFull = true;
      if (token === '--fail-on-regression') args.failOnRegression = true;
      if (token === '--write') args.write = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new Error(`Flag desconhecida: ${token}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${token} exige um valor`);
    }
    i += 1;
    if (token === '--tipo') args.tipos = parseList(value);
    if (token === '--ids') args.ids = parseList(value);
    if (token === '--out') args.out = value;
    if (token === '--compare') args.compare = value;
    if (token === '--file') args.file = value;
    if (token === '--grep') args.grep = value;
    if (token === '--max-llm-calls') args.maxLlmCalls = parsePositiveInt(token, value);
    if (token === '--days') args.days = parsePositiveInt(token, value);
  }
  // Depois do laço: --allow-full pode vir depois de --max-llm-calls.
  assertLlmCallLimit(args.maxLlmCalls, args.allowFull);
  return args;
}
