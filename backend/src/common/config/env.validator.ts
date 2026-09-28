/**
 * Validador fail-fast das variáveis de ambiente em produção.
 *
 * Chamado uma única vez no bootstrap do backend (main.ts) ANTES do
 * NestFactory.create — garante que nenhum módulo seja instanciado com
 * variáveis faltando ou com valores-placeholder óbvios.
 *
 * Em desenvolvimento e em testes (NODE_ENV !== 'production') é no-op:
 * os testes e2e/unit existentes não definem todas as variáveis e isso
 * bloqueava a inicialização. Manter a checagem exclusiva em produção é
 * o padrão usado por NestJS, Next.js, etc.
 *
 * Resolve F-15 (parcialmente — exige também o ValidationPipe), F-21
 * (centraliza fail-fast dos segredos JWT e Google), F-23 (RESEND_API_KEY),
 * F-26 (MERCADOPAGO_WEBHOOK_SECRET).
 *
 * ITEM 010 (auditoria 2026-09-27): passou a cobrir também DATABASE_URL,
 * REDIS_URL, MERCADOPAGO_ACCESS_TOKEN e as credenciais do R2 — mesma classe de
 * risco de F-21/F-26: sem elas o backend subia normalmente e só falhava na
 * primeira chamada real, com erro opaco (pg cai para localhost/sem senha;
 * Mercado Pago/R2 recebiam a string placeholder 'missing-*').
 *
 * Também cobre PUBLIC_APP_URL (2026-09-28): presença confirmada no container de
 * produção antes de torná-la obrigatória, para o próximo deploy não entrar em loop.
 */
const REQUIRED = [
  ['JWT_SECRET', (v: string) => v.length >= 32, 'mínimo 32 caracteres (256 bits)'],
  ['GOOGLE_TOKEN_ENCRYPTION_KEY', (v: string) => /^[0-9a-f]{64}$/i.test(v), '64 caracteres hex (32 bytes)'],
  ['MERCADOPAGO_WEBHOOK_SECRET', (v: string) => v.length >= 16, 'mínimo 16 caracteres'],
  ['RESEND_API_KEY', (v: string) => v.startsWith('re_'), 'deve começar com re_'],
  ['MINIMAX_API_KEY', (v: string) => v.length >= 20, 'mínimo 20 caracteres'],
  ['OPENROUTER_API_KEY', (v: string) => v.startsWith('sk-or-'), 'deve começar com sk-or-'],
  ['DATABASE_URL', (v: string) => /^postgres(ql)?:\/\//.test(v), 'deve ser uma URL postgres://'],
  ['REDIS_URL', (v: string) => /^rediss?:\/\//.test(v), 'deve ser uma URL redis://'],
  ['MERCADOPAGO_ACCESS_TOKEN', (v: string) => v.length >= 20, 'mínimo 20 caracteres'],
  ['R2_ENDPOINT', (v: string) => /^https:\/\/\S+$/.test(v), 'deve ser uma URL https://'],
  ['R2_ACCESS_KEY_ID', (v: string) => v.length >= 16, 'mínimo 16 caracteres'],
  ['R2_SECRET_ACCESS_KEY', (v: string) => v.length >= 32, 'mínimo 32 caracteres'],
  ['R2_BUCKET', (v: string) => v.length >= 3, 'mínimo 3 caracteres'],
  // Base dos links enviados por e-mail (confirmação de cadastro, redefinição de
  // senha) e do retorno do checkout. Sem ela o e-mail sai com "undefined/..." e
  // ninguém é avisado; https porque o link carrega token; sem barra final porque o
  // código concatena `${PUBLIC_APP_URL}/caminho`.
  ['PUBLIC_APP_URL', (v: string) => /^https:\/\/\S+$/.test(v) && !v.endsWith('/'), 'deve ser uma URL https:// sem barra no final'],
] as const;

// Inclui os placeholders que os serviços usam como fallback quando a variável
// falta (email/mercadopago/r2) — se algum deles chegar aqui, é config errada.
const FORBIDDEN_VALUES = [
  'dev-secret-change-me',
  'changeme',
  'secret',
  'missing-api-key',
  'missing-access-token',
  'missing-access-key',
  'missing-secret-key',
  'https://missing-r2-endpoint.example.com',
  '',
];

// Pura (recebe o ambiente, devolve os erros) para poder ser testada sem
// derrubar o processo.
export function collectEnvErrors(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];

  for (const [name, check, description] of REQUIRED) {
    const value = env[name];
    if (value === undefined) {
      errors.push(`✗ ${name}: ausente — ${description}`);
      continue;
    }
    if (FORBIDDEN_VALUES.includes(value) || !check(value)) {
      errors.push(`✗ ${name}: valor inválido — ${description}`);
    }
  }
  return errors;
}

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = collectEnvErrors(process.env);

  if (errors.length > 0) {
    // Log no stderr em formato texto-ASCII simples (sem dependência de JSON
    // logger — o processo vai morrer logo após este log).
    process.stderr.write(
      `\n[FATAL] Configuração inválida do backend Montese SST em produção:\n` +
        errors.map((e) => `  ${e}`).join('\n') +
        '\n\nCorrija o .env (ou o secret manager) e reinicie o container.\n',
    );
    // Exit code 1 — docker reinicia automaticamente conforme policy
    // (a menos que seja um erro de config; ver docker-compose restart policy).
    process.exit(1);
  }
}
