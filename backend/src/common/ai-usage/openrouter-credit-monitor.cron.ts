import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';

// ITEM 013 (auditoria 2026-09-27): sem isto, quando a conta do OpenRouter fica sem
// crédito, cada chamada (embeddings, copiloto de checklist, provedor alternativo de
// resposta normativa) só vira um 502 genérico no log — ninguém é avisado. Endpoint oficial
// de saldo da própria conta — VERIFICADO em
// https://openrouter.ai/docs/api-reference/limits (consultado em 2026-09-30):
// GET /api/v1/key, Bearer <chave>, devolve
// { data: { limit_remaining, limit, usage_daily, is_free_tier, ... } }
// (limit/limit_remaining vêm null quando a chave não tem teto configurado).
//
// A rota de alertas do admin NUNCA chama isto direto (comentário em
// AdminDashboardService.getAlertas: "nada de OpenRouter etc., pro sininho do topbar nunca
// travar por terceiro") — este cron roda em background e grava o resultado numa linha
// única (openrouter_credit_status), que a rota só lê.
export const OPENROUTER_KEY_ENDPOINT_URL = 'https://openrouter.ai/api/v1/key';

interface OpenRouterKeyResponse {
  data?: {
    limit_remaining?: number | null;
    limit?: number | null;
    usage_daily?: number | null;
  };
}

@Injectable()
export class OpenRouterCreditMonitorCronService {
  private readonly logger = new Logger(OpenRouterCreditMonitorCronService.name);

  constructor(private readonly db: DatabaseService) {}

  // A cada 6h — mesma cadência de SubscriptionReconciliationCronService: é um monitor de
  // infraestrutura, não algo que precise de tempo real, e evita gastar chamadas à toa
  // contra a API deles.
  @Cron('0 */6 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<void> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      // Mesma checagem que OpenRouterEmbeddingService já faz — sem chave configurada,
      // não é uma FALHA de infraestrutura a ser alertada, é ambiente sem essa integração.
      return;
    }

    try {
      const response = await fetch(OPENROUTER_KEY_ENDPOINT_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await this.save({ check_succeeded: false, error_message: `OpenRouter respondeu status ${response.status}` });
        return;
      }
      const body = (await response.json()) as OpenRouterKeyResponse;
      const limitRemaining = body.data?.limit_remaining;
      const limit = body.data?.limit;
      const usageDaily = body.data?.usage_daily;

      await this.save({
        check_succeeded: true,
        is_unlimited: limitRemaining === null || limitRemaining === undefined,
        limit_remaining_usd: typeof limitRemaining === 'number' ? limitRemaining : null,
        limit_usd: typeof limit === 'number' ? limit : null,
        usage_daily_usd: typeof usageDaily === 'number' ? usageDaily : null,
      });
    } catch (err) {
      this.logger.error('Falha ao consultar o saldo do OpenRouter', (err as Error).stack);
      await this.save({ check_succeeded: false, error_message: (err as Error).message });
    }
  }

  private async save(fields: {
    check_succeeded: boolean;
    is_unlimited?: boolean;
    limit_remaining_usd?: number | null;
    limit_usd?: number | null;
    usage_daily_usd?: number | null;
    error_message?: string;
  }): Promise<void> {
    try {
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO openrouter_credit_status
             (id, checked_at, check_succeeded, is_unlimited, limit_remaining_usd, limit_usd, usage_daily_usd, error_message)
           VALUES (1, now(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             checked_at = EXCLUDED.checked_at,
             check_succeeded = EXCLUDED.check_succeeded,
             is_unlimited = EXCLUDED.is_unlimited,
             limit_remaining_usd = EXCLUDED.limit_remaining_usd,
             limit_usd = EXCLUDED.limit_usd,
             usage_daily_usd = EXCLUDED.usage_daily_usd,
             error_message = EXCLUDED.error_message`,
          [
            fields.check_succeeded,
            fields.is_unlimited ?? false,
            fields.limit_remaining_usd ?? null,
            fields.limit_usd ?? null,
            fields.usage_daily_usd ?? null,
            fields.error_message ?? null,
          ],
        ),
      );
    } catch (err) {
      // Nunca lança: gravar o monitoramento é best-effort, mesma regra de AiUsageLogService.log.
      this.logger.error('Falha ao gravar o status de crédito do OpenRouter no banco', (err as Error).stack);
    }
  }
}
