import { collectEnvErrors, validateProductionEnv } from '../src/common/config/env.validator';

// ITEM 010 (auditoria 2026-09-27): o validador fail-fast de produção passou a
// cobrir também DATABASE_URL, REDIS_URL, MERCADOPAGO_ACCESS_TOKEN e o R2.
// Antes disto o validador não tinha nenhum teste.

const validEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(48),
  GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  MERCADOPAGO_WEBHOOK_SECRET: 'w'.repeat(24),
  RESEND_API_KEY: 're_abcdefghijklmnop',
  MINIMAX_API_KEY: 'm'.repeat(40),
  OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnopqrstuvwxyz',
  DATABASE_URL: 'postgresql://montese_app:senha@postgres:5432/montese',
  REDIS_URL: 'redis://:senha@redis:6379',
  MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-1234567890-abcdef',
  R2_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'k'.repeat(32),
  R2_SECRET_ACCESS_KEY: 's'.repeat(64),
  R2_BUCKET: 'montese-docs',
  PUBLIC_APP_URL: 'https://montesesst.com.br',
});

describe('collectEnvErrors', () => {
  it('ambiente completo e válido não gera erro', () => {
    expect(collectEnvErrors(validEnv())).toEqual([]);
  });

  it.each([
    'JWT_SECRET',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
    'MERCADOPAGO_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'MINIMAX_API_KEY',
    'OPENROUTER_API_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'MERCADOPAGO_ACCESS_TOKEN',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'PUBLIC_APP_URL',
  ])('variável ausente (%s) é reportada pelo nome', (name) => {
    const env = validEnv();
    delete env[name];
    const errors = collectEnvErrors(env);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`${name}: ausente`);
  });

  it('DATABASE_URL que não é postgres:// é recusada (pg cairia em localhost sem senha)', () => {
    const env = validEnv();
    env.DATABASE_URL = 'mysql://x';
    expect(collectEnvErrors(env)[0]).toContain('DATABASE_URL: valor inválido');
  });

  it('REDIS_URL aceita redis:// e rediss://, recusa outros esquemas', () => {
    const env = validEnv();
    env.REDIS_URL = 'rediss://:senha@host:6380';
    expect(collectEnvErrors(env)).toEqual([]);
    env.REDIS_URL = 'http://host';
    expect(collectEnvErrors(env)[0]).toContain('REDIS_URL: valor inválido');
  });

  it('R2_ENDPOINT precisa ser https (recusa http:// e o placeholder de fallback do R2Service)', () => {
    const env = validEnv();
    env.R2_ENDPOINT = 'http://conta.r2.cloudflarestorage.com';
    expect(collectEnvErrors(env)[0]).toContain('R2_ENDPOINT: valor inválido');
    env.R2_ENDPOINT = 'https://missing-r2-endpoint.example.com';
    expect(collectEnvErrors(env)[0]).toContain('R2_ENDPOINT: valor inválido');
  });

  it.each([
    ['MERCADOPAGO_ACCESS_TOKEN', 'missing-access-token'],
    ['R2_ACCESS_KEY_ID', 'missing-access-key'],
    ['R2_SECRET_ACCESS_KEY', 'missing-secret-key'],
    ['RESEND_API_KEY', 'missing-api-key'],
    ['JWT_SECRET', 'dev-secret-change-me'],
  ])('%s com o placeholder de fallback do código (%s) é recusada', (name, placeholder) => {
    const env = validEnv();
    env[name] = placeholder;
    expect(collectEnvErrors(env).join('\n')).toContain(`${name}: valor inválido`);
  });

  it('valor curto demais é recusado (segredos fracos)', () => {
    const env = validEnv();
    env.R2_SECRET_ACCESS_KEY = 'curta';
    env.MERCADOPAGO_ACCESS_TOKEN = 'curto';
    const errors = collectEnvErrors(env);
    expect(errors).toHaveLength(2);
  });

  it('acumula todos os erros de uma vez (o operador corrige tudo numa só tentativa)', () => {
    const errors = collectEnvErrors({ NODE_ENV: 'production' });
    expect(errors).toHaveLength(14);
  });

  it('PUBLIC_APP_URL: recusa http://, barra no final e o texto "undefined" (o link do e-mail sairia quebrado ou sem TLS)', () => {
    const env = validEnv();
    for (const bad of ['http://montesesst.com.br', 'https://montesesst.com.br/', 'undefined', 'montesesst.com.br', '']) {
      env.PUBLIC_APP_URL = bad;
      expect(collectEnvErrors(env).join('\n')).toContain('PUBLIC_APP_URL:');
    }
    env.PUBLIC_APP_URL = 'https://montesesst.com.br';
    expect(collectEnvErrors(env)).toEqual([]);
  });

  it('nunca inclui o VALOR da variável na mensagem de erro', () => {
    const env = validEnv();
    env.JWT_SECRET = 'segredo-curto-que-nao-pode-vazar';
    expect(collectEnvErrors(env).join('\n')).not.toContain('segredo-curto-que-nao-pode-vazar');
  });
});

describe('validateProductionEnv', () => {
  const originalEnv = process.env;
  let exitSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('fora de produção (dev/test) é no-op mesmo sem nenhuma variável', () => {
    process.env = { NODE_ENV: 'test' };
    validateProductionEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('em produção com ambiente válido não derruba o processo', () => {
    process.env = validEnv();
    validateProductionEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('em produção com variável faltando: escreve o motivo no stderr e sai com código 1', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    process.env = env;
    validateProductionEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('DATABASE_URL: ausente');
  });
});
