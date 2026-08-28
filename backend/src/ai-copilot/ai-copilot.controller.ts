import { Controller, Get, Logger } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';

export interface AiUsageResponse {
  configured: boolean;
  provider: 'openrouter';
  is_free_tier?: boolean;
  total_credits?: number;
  total_usage?: number;
  usage_daily?: number;
  usage_weekly?: number;
  usage_monthly?: number;
  low_balance_warning?: boolean;
  dashboard_url: string;
  error?: string;
}

// Só leitura de saldo/uso — a API do OpenRouter não tem endpoint pra
// adicionar crédito por fora, isso é sempre manual no painel deles
// (confirmado via documentação oficial, 2026-08-28).
const DASHBOARD_URL = 'https://openrouter.ai/settings/credits';

@Controller('ai-copilot')
export class AiCopilotController {
  private readonly logger = new Logger(AiCopilotController.name);

  @Roles('admin')
  @Get('usage')
  async usage(): Promise<AiUsageResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { configured: false, provider: 'openrouter', dashboard_url: DASHBOARD_URL };
    }

    try {
      const [creditsRes, keyRes] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/credits', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        }),
        fetch('https://openrouter.ai/api/v1/key', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        }),
      ]);

      if (!creditsRes.ok || !keyRes.ok) {
        this.logger.error(`OpenRouter status: credits=${creditsRes.status} key=${keyRes.status}`);
        return {
          configured: true,
          provider: 'openrouter',
          dashboard_url: DASHBOARD_URL,
          error: 'Não foi possível consultar o saldo agora.',
        };
      }

      const credits = (await creditsRes.json())?.data ?? {};
      const key = (await keyRes.json())?.data ?? {};

      const totalCredits = Number(credits.total_credits ?? 0);
      // Free tier sem crédito comprado ainda consegue gerar chamada com uma
      // cota gratuita à parte (confirmado em teste real, 2026-08-28) — não
      // dá pra calcular "saldo restante" de forma confiável nesse caso, só
      // avisar que não há crédito comprado.
      const lowBalanceWarning = key.is_free_tier === true && totalCredits === 0;

      return {
        configured: true,
        provider: 'openrouter',
        is_free_tier: key.is_free_tier ?? undefined,
        total_credits: totalCredits,
        total_usage: Number(credits.total_usage ?? 0),
        usage_daily: Number(key.usage_daily ?? 0),
        usage_weekly: Number(key.usage_weekly ?? 0),
        usage_monthly: Number(key.usage_monthly ?? 0),
        low_balance_warning: lowBalanceWarning,
        dashboard_url: DASHBOARD_URL,
      };
    } catch (err) {
      this.logger.error('Falha ao consultar uso do OpenRouter', (err as Error).stack);
      return {
        configured: true,
        provider: 'openrouter',
        dashboard_url: DASHBOARD_URL,
        error: 'Não foi possível consultar o saldo agora.',
      };
    }
  }
}
