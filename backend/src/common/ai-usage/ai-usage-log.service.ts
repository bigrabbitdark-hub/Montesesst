import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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

  constructor(private readonly db: DatabaseService) {}

  // Nunca lança — registrar uso é best-effort; uma falha aqui não pode
  // derrubar a resposta real da IA que já foi obtida com sucesso.
  async log(capability: string, usage: TokenUsage): Promise<void> {
    try {
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO minimax_usage_log (capability, prompt_tokens, completion_tokens, total_tokens)
           VALUES ($1, $2, $3, $4)`,
          [capability, usage.prompt_tokens, usage.completion_tokens, usage.total_tokens],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao registrar uso da MiniMax (capability=${capability})`, (err as Error).stack);
    }
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
