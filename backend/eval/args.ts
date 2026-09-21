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

function parsePositiveInt(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} exige um inteiro positivo (recebido "${raw}")`);
  }
  return value;
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
  return args;
}
