import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { estimateMinimaxCostUsd } from './minimax-cost.util';

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageSummaryRow {
  capability: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageSummary {
  total_calls: number;
  total_tokens: number;
  by_capability: UsageSummaryRow[];
  last_7_days: { date: string; total_tokens: number }[];
}

// minimax_usage_log não tem RLS (dado operacional interno, não de
// tenant) — mesma categoria de caepi_records/official_sources.
@Injectable()
export class AiUsageLogService {
  private readonly logger = new Logger(AiUsageLogService.name);

  // @Inject(ClasseConcreta) explícito: mesma causa raiz do fix em
  // NormativeAssistantService (Task 8) e em MiniMaxNormativeAnswerService
  // (Task 9) — sem isto, sob tsx (esbuild não emite design:paramtypes),
  // `this.db` chegava `undefined`. Aqui o método log() já tinha try/catch
  // (nunca lança), então o sintoma não era um crash visível: era o log de
  // uso real da IA ficando silenciosamente vazio, mascarando o gasto.
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  // Nunca lança — registrar uso é best-effort; uma falha aqui não pode
  // derrubar a resposta real da IA que já foi obtida com sucesso.
  async log(capability: string, usage: TokenUsage): Promise<void> {
    try {
      // ITEM 014: custo ESTIMADO (nunca fatura real — a MiniMax não expõe saldo/uso, ver
      // minimax-cost.util.ts) gravado junto, para o alerta de teto de custo diário.
      const estimatedCostUsd = estimateMinimaxCostUsd(usage.prompt_tokens, usage.completion_tokens);
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO minimax_usage_log (capability, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
           VALUES ($1, $2, $3, $4, $5)`,
          [capability, usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, estimatedCostUsd],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao registrar uso da MiniMax (capability=${capability})`, (err as Error).stack);
    }
  }

  // ITEM 014: soma do custo ESTIMADO da MiniMax hoje (America/Sao_Paulo, mesmo fuso já
  // usado em AdminDashboardService.getFinanceiro) — consumida pelo alerta de teto de
  // custo diário. Linhas antigas sem estimated_cost_usd (gravadas antes desta migration)
  // contam como 0, não como erro.
  async getTodayEstimatedCostUsd(): Promise<number> {
    return this.db.withoutTenantContext(async (client) => {
      const result = await client.query<{ total: string | null }>(
        `SELECT COALESCE(sum(estimated_cost_usd), 0) AS total
         FROM minimax_usage_log
         WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`,
      );
      return Number(result.rows[0].total ?? 0);
    });
  }

  async getSummary(): Promise<UsageSummary> {
    return this.db.withoutTenantContext(async (client) => {
      const totalsResult = await client.query<{ total_calls: string; total_tokens: string | null }>(
        `SELECT count(*) AS total_calls, COALESCE(sum(total_tokens), 0) AS total_tokens FROM minimax_usage_log`,
      );

      const byCapabilityResult = await client.query<{
        capability: string;
        calls: string;
        prompt_tokens: string;
        completion_tokens: string;
        total_tokens: string;
      }>(
        `SELECT capability, count(*) AS calls, sum(prompt_tokens) AS prompt_tokens,
                sum(completion_tokens) AS completion_tokens, sum(total_tokens) AS total_tokens
         FROM minimax_usage_log
         GROUP BY capability
         ORDER BY sum(total_tokens) DESC`,
      );

      const last7DaysResult = await client.query<{ date: string; total_tokens: string }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, sum(total_tokens) AS total_tokens
         FROM minimax_usage_log
         WHERE created_at >= now() - interval '7 days'
         GROUP BY date_trunc('day', created_at)
         ORDER BY date_trunc('day', created_at) ASC`,
      );

      return {
        total_calls: Number(totalsResult.rows[0].total_calls),
        total_tokens: Number(totalsResult.rows[0].total_tokens),
        by_capability: byCapabilityResult.rows.map((row) => ({
          capability: row.capability,
          calls: Number(row.calls),
          prompt_tokens: Number(row.prompt_tokens),
          completion_tokens: Number(row.completion_tokens),
          total_tokens: Number(row.total_tokens),
        })),
        last_7_days: last7DaysResult.rows.map((row) => ({
          date: row.date,
          total_tokens: Number(row.total_tokens),
        })),
      };
    });
  }
}
