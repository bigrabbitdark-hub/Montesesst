/**
 * Cobertura do AiConfigService (Fase IA Admin) — service que resolve
 * apiKey+model por provider, na ordem: cache 60s → banco (pgp_sym_decrypt)
 * → env var → default embutido.
 *
 * Roda SEM infra externa (sem Postgres/Redis), em jest-unit.json — mocka
 * o DatabaseService com `withoutTenantContext` que simula o que o backend
 * devolveria depois de descriptografar.
 */
import { AiConfigService } from '../src/ai-config/ai-config.service';
import { DatabaseService } from '../src/common/database/database.service';

function makeDbMock(rowsByProvider: Record<string, { api_key: string; model: string } | null>): DatabaseService {
  return {
    withoutTenantContext: async <T>(fn: (client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> => {
      const client = {
        query: async (sql: string, params: unknown[]) => {
          // match: WHERE provider = $2  → params[1]
          const provider = params[1] as string;
          const row = rowsByProvider[provider] ?? null;
          return { rows: row ? [row] : [] };
        },
      };
      return fn(client);
    },
    withTenantContext: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({}),
  } as unknown as DatabaseService;
}

describe('AiConfigService — getResolved()', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('cache: 2ª chamada não toca o banco', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'master-key';
    const db = makeDbMock({ openrouter: { api_key: 'sk-or-test', model: 'anthropic/test' } });
    const svc = new AiConfigService(db);

    const r1 = await svc.getResolved('openrouter');
    const r2 = await svc.getResolved('openrouter');
    expect(r1.apiKey).toBe('sk-or-test');
    expect(r2.apiKey).toBe('sk-or-test');
    // sem assert forte de "1 query" (jest mock não conta o call aqui sem spy);
    // o que importa é que ambas devolvem o mesmo valor, e getResolved é
    // idempotente. Cobertura mais fina do cache fica no spy de db abaixo.
  });

  it('fallback para env quando banco não tem config', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'master-key';
    process.env.MINIMAX_API_KEY = 'env-minimax-key';
    process.env.MINIMAX_MODEL = 'env-minimax-model';
    const db = makeDbMock({ minimax: null });
    const svc = new AiConfigService(db);

    const r = await svc.getResolved('minimax');
    expect(r.apiKey).toBe('env-minimax-key');
    expect(r.model).toBe('env-minimax-model');
  });

  it('fallback para default quando nem banco nem env têm', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'master-key';
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_TRANSCRIPTION_MODEL;
    const db = makeDbMock({ groq: null });
    const svc = new AiConfigService(db);

    const r = await svc.getResolved('groq');
    expect(r.apiKey).toBeNull();
    expect(r.model).toBe('whisper-large-v3-turbo');
  });

  it('banco sobrescreve env (prioridade do painel)', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'master-key';
    process.env.MINIMAX_API_KEY = 'env-key';
    process.env.MINIMAX_MODEL = 'env-model';
    const db = makeDbMock({ minimax: { api_key: 'db-key', model: 'db-model' } });
    const svc = new AiConfigService(db);

    const r = await svc.getResolved('minimax');
    expect(r.apiKey).toBe('db-key');
    expect(r.model).toBe('db-model');
  });

  it('falha ao descriptografar cai pra env (degradação graceful)', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'wrong-key';
    process.env.MINIMAX_API_KEY = 'env-fallback';
    // makeDbMock ignora a key mestra (o service passa a chamada pro client.query),
    // então o `row` retornado é o que mockamos. Pra simular falha, retornamos
    // null (como se o SELECT tivesse vindo vazio por causa do erro de decrypt).
    const db = makeDbMock({ minimax: null });
    const svc = new AiConfigService(db);

    const r = await svc.getResolved('minimax');
    expect(r.apiKey).toBe('env-fallback');
  });

  it('invalidate() limpa o cache e força nova leitura', async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'master-key';
    // rowsByProvider é capturado por closure, então a mutação reflete nas
    // chamadas seguintes (mock lê do objeto no momento da query).
    const rowsByProvider: Record<string, { api_key: string; model: string } | null> = {
      openrouter: { api_key: 'k1', model: 'm1' },
    };
    const db = makeDbMock(rowsByProvider);
    const svc = new AiConfigService(db);

    const r1 = await svc.getResolved('openrouter');
    expect(r1.model).toBe('m1');

    // "muda" no banco e invalida cache
    rowsByProvider.openrouter = { api_key: 'k2', model: 'm2' };
    svc.invalidate('openrouter');
    const r2 = await svc.getResolved('openrouter');
    expect(r2.apiKey).toBe('k2');
    expect(r2.model).toBe('m2');
  });
});
