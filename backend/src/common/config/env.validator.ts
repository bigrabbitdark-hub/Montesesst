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
 */
const REQUIRED = [
  ['JWT_SECRET', (v: string) => v.length >= 32, 'mínimo 32 caracteres (256 bits)'],
  ['GOOGLE_TOKEN_ENCRYPTION_KEY', (v: string) => /^[0-9a-f]{64}$/i.test(v), '64 caracteres hex (32 bytes)'],
  ['MERCADOPAGO_WEBHOOK_SECRET', (v: string) => v.length >= 16, 'mínimo 16 caracteres'],
  ['RESEND_API_KEY', (v: string) => v.startsWith('re_'), 'deve começar com re_'],
  ['MINIMAX_API_KEY', (v: string) => v.length >= 20, 'mínimo 20 caracteres'],
  ['OPENROUTER_API_KEY', (v: string) => v.startsWith('sk-or-'), 'deve começar com sk-or-'],
] as const;

const FORBIDDEN_VALUES = ['dev-secret-change-me', 'changeme', 'secret', 'missing-api-key', ''];

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const errors: string[] = [];

  for (const [name, check, description] of REQUIRED) {
    const value = process.env[name];
    if (value === undefined) {
      errors.push(`✗ ${name}: ausente — ${description}`);
      continue;
    }
    if (FORBIDDEN_VALUES.includes(value) || !check(value)) {
      errors.push(`✗ ${name}: valor inválido — ${description}`);
    }
  }

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
