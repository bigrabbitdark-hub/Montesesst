import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { AI_PROVIDER_LABEL, AI_PROVIDERS, AiProviderAdminView, AiProviderId, ResolvedAiConfig } from './ai-config.types';

interface CacheEntry {
  fetchedAt: number;
  apiKey: string | null;
  model: string;
}

// 60s é folga generosa pra troca manual de chave via painel (não é alta
// frequência). Mantém o banco protegido de martelada em picos de uso de IA.
const CACHE_TTL_MS = 60_000;

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);
  private cache = new Map<AiProviderId, CacheEntry>();

  // @Inject(DatabaseService) explícito: mesma causa raiz do fix em
  // MiniMaxNormativeAnswerService / AiUsageLogService — sem isto, sob tsx
  // (esbuild não emite design:paramtypes), `this.db` chegaria undefined.
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  // Entrada principal usada pelos services consumidores (ai-copilot,
  // cipa/ata-ai, normative). Ordem de resolução:
  //   1) cache em memória (TTL 60s) — evita martelada no banco em picos
  //   2) banco (api_key cifrada com pgcrypto) — config vinda do painel
  //   3) env var — fallback p/ deploys que ainda dependem de .env
  //   4) default embutido no service — quando nem env tem modelo
  async getResolved(provider: AiProviderId): Promise<ResolvedAiConfig> {
    const cached = this.cache.get(provider);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return { provider, apiKey: cached.apiKey, model: cached.model, baseUrl: null };
    }

    let apiKey: string | null = null;
    let modelFromDb: string | null = null;
    try {
      const row = await this.db.withoutTenantContext(async (client) => {
        const result = await client.query<{ api_key: string | null; model: string }>(
          `SELECT pgp_sym_decrypt(api_key_encrypted, $1) AS api_key, model
             FROM ai_provider_configs
             WHERE provider = $2`,
          [this.getMasterKey(), provider],
        );
        return result.rows[0] ?? null;
      });
      if (row?.api_key) {
        apiKey = row.api_key;
        modelFromDb = row.model;
      }
    } catch (err) {
      // Chave mestra ausente ou pgcrypto falhou: loga UMA VEZ por falha
      // e cai pra env. Pior cenário: painel mostra "config indisponível" e
      // consumers continuam funcionando via env (deploy atual não quebra).
      this.logger.warn(
        `ai_provider_configs: leitura falhou (provider=${provider}) — usando env var. Erro: ${(err as Error).message}`,
      );
    }

    if (!apiKey) apiKey = this.getEnvApiKey(provider);
    const model = modelFromDb ?? this.getEnvModel(provider) ?? this.getDefaultModel(provider);

    this.cache.set(provider, { fetchedAt: now, apiKey, model });
    return { provider, apiKey, model, baseUrl: null };
  }

  // Limpar cache — chamado após PUT/POST (controller) e em testes.
  invalidate(provider?: AiProviderId): void {
    if (provider) this.cache.delete(provider);
    else this.cache.clear();
  }

  // Visão pro painel /admin/ia. SEMPRE retorna os 3 provedores (mesmo os
  // sem config no banco), pra UI renderizar cards uniformes. apiKeyMasked
  // é null quando a config não existe em lugar nenhum.
  async listForAdmin(): Promise<AiProviderAdminView[]> {
    const dbRows = await this.db.withoutTenantContext(async (client) => {
      try {
        const { rows } = await client.query<{
          provider: string;
          model: string;
          api_key: string | null;
          updated_at: string;
          updated_by_admin_id: string | null;
        }>(
          `SELECT provider, model,
                  pgp_sym_decrypt(api_key_encrypted, $1) AS api_key,
                  updated_at,
                  updated_by_admin_id
             FROM ai_provider_configs`,
          [this.getMasterKey()],
        );
        return rows;
      } catch (err) {
        this.logger.warn(
          `ai_provider_configs: listagem falhou — usando só env vars. Erro: ${(err as Error).message}`,
        );
        return [];
      }
    });

    return AI_PROVIDERS.map((provider) => {
      const row = dbRows.find((r) => r.provider === provider);
      const envKey = this.getEnvApiKey(provider);
      if (row?.api_key) {
        return {
          provider,
          providerLabel: AI_PROVIDER_LABEL[provider],
          configured: true,
          source: 'db',
          model: row.model,
          apiKeyMasked: this.maskApiKey(row.api_key),
          updatedAt: row.updated_at,
          updatedByAdminId: row.updated_by_admin_id,
        };
      }
      if (envKey) {
        return {
          provider,
          providerLabel: AI_PROVIDER_LABEL[provider],
          configured: true,
          source: 'env',
          model: this.getEnvModel(provider) ?? this.getDefaultModel(provider),
          apiKeyMasked: this.maskApiKey(envKey),
          updatedAt: null,
          updatedByAdminId: null,
        };
      }
      return {
        provider,
        providerLabel: AI_PROVIDER_LABEL[provider],
        configured: false,
        source: 'none',
        model: this.getDefaultModel(provider),
        apiKeyMasked: null,
        updatedAt: null,
        updatedByAdminId: null,
      };
    });
  }

  // Gravar config no painel. Precisa setar app.role=admin manualmente
  // porque withoutTenantContext não tem o req.user populado pelo JwtAuthGuard.
  // O detail do audit_log (montado pelo AuditInterceptor global) fica com
  // `provider=X;source=db` — NUNCA traz o valor da chave.
  async upsert(provider: AiProviderId, apiKey: string, model: string, adminUserId: string): Promise<void> {
    const masterKey = this.getMasterKey();
    await this.db.withoutTenantContext(async (client) => {
      await client.query('BEGIN');
      try {
        // SET LOCAL expira no COMMIT — não vaza pra conexão seguinte do pool.
        await client.query("SELECT set_config('app.role', 'admin', true)");
        await client.query(
          `INSERT INTO ai_provider_configs (provider, api_key_encrypted, model, updated_by_admin_id)
             VALUES ($1, pgp_sym_encrypt($2, $3), $4, $5)
           ON CONFLICT (provider) DO UPDATE
             SET api_key_encrypted = EXCLUDED.api_key_encrypted,
                 model = EXCLUDED.model,
                 updated_by_admin_id = EXCLUDED.updated_by_admin_id,
                 updated_at = now()`,
          [provider, apiKey, masterKey, model, adminUserId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    this.invalidate(provider);
  }

  // Testar a credencial do provider com a chamada mais barata possível
  // (sem gastar tokens / sem prompt). Cada provider expõe um endpoint
  // de "listar modelos" ou "validar chave" que retorna 200 só com a
  // key válida.
  async testConnection(provider: AiProviderId): Promise<{ ok: boolean; detail: string; model: string }> {
    const resolved = await this.getResolved(provider);
    if (!resolved.apiKey) {
      return { ok: false, detail: 'Sem chave configurada (nem banco nem env).', model: resolved.model };
    }
    const endpoints: Record<AiProviderId, { url: string; okStatuses: number[] }> = {
      minimax: { url: 'https://api.minimax.io/v1/models', okStatuses: [200] },
      openrouter: { url: 'https://openrouter.ai/api/v1/auth/key', okStatuses: [200] },
      groq: { url: 'https://api.groq.com/openai/v1/models', okStatuses: [200] },
    };
    const { url, okStatuses } = endpoints[provider];
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${resolved.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (okStatuses.includes(res.status)) {
        return { ok: true, detail: `Conectado (${AI_PROVIDER_LABEL[provider]}).`, model: resolved.model };
      }
      return {
        ok: false,
        detail: `${AI_PROVIDER_LABEL[provider]} retornou status ${res.status}.`,
        model: resolved.model,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `Falha de rede: ${(err as Error).message}`,
        model: resolved.model,
      };
    }
  }

  // -------- helpers --------

  private getMasterKey(): string {
    const key = process.env.AI_CONFIG_ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        'AI_CONFIG_ENCRYPTION_KEY ausente do ambiente — chave mestra obrigatória para descriptografar ai_provider_configs.',
      );
    }
    return key;
  }

  private getEnvApiKey(provider: AiProviderId): string | null {
    return process.env[this.envKeyVar(provider)] ?? null;
  }

  private getEnvModel(provider: AiProviderId): string | null {
    const envVar = this.envModelVar(provider);
    return envVar ? process.env[envVar] ?? null : null;
  }

  private envKeyVar(provider: AiProviderId): string {
    return { minimax: 'MINIMAX_API_KEY', openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY' }[provider];
  }

  private envModelVar(provider: AiProviderId): string | null {
    return {
      minimax: 'MINIMAX_MODEL',
      openrouter: 'OPENROUTER_MODEL',
      groq: 'GROQ_TRANSCRIPTION_MODEL',
    }[provider];
  }

  private getDefaultModel(provider: AiProviderId): string {
    return {
      minimax: 'MiniMax-M3',
      openrouter: 'anthropic/claude-sonnet-5',
      groq: 'whisper-large-v3-turbo',
    }[provider];
  }

  // Mascaramento: "sk-or-v1-abc...XYZW" (3 primeiros + "…" + 4 últimos).
  // Chave com menos de 8 chars (não esperado de provider real) vira "••••".
  private maskApiKey(key: string): string {
    if (key.length <= 8) return '••••';
    return `${key.slice(0, 3)}…${key.slice(-4)}`;
  }
}
