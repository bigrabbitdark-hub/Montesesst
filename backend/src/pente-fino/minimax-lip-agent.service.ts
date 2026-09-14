import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { LipAgentExtraction, LipAgentExtractionProvider } from './lip-agent-provider.interface';
import { buildLipAgentChatCompletionBody, parseLipAgentToolCall } from './lip-agent-extraction-shared';
import { AiUsageLogService } from '../common/ai-usage/ai-usage-log.service';

// Mesmo padrão de MiniMaxFunctionExtractionService/MiniMaxDocumentChecklistService
// — só MiniMax implementado nesta fase, interface garante trocabilidade
// futura. Timeout 60s (entrada é o documento inteiro).
@Injectable()
export class MiniMaxLipAgentService implements LipAgentExtractionProvider {
  private readonly logger = new Logger(MiniMaxLipAgentService.name);

  constructor(private readonly usageLog: AiUsageLogService) {}

  async extract(fullText: string): Promise<LipAgentExtraction[]> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Extração de agentes do LIP ainda não está disponível');
    }

    const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
    let response: Response;
    try {
      response = await fetch('https://api.minimax.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildLipAgentChatCompletionBody(model, fullText)),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax (agentes do LIP)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair os agentes agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort
      }
      this.logger.error(`MiniMax retornou status ${response.status} (agentes do LIP): ${errorBody}`);
      throw new BadGatewayException('Não foi possível extrair os agentes agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido (agentes do LIP)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair os agentes agora');
    }

    if (body?.usage) {
      await this.usageLog.log('pente_fino_lip_agent', {
        prompt_tokens: body.usage.prompt_tokens ?? 0,
        completion_tokens: body.usage.completion_tokens ?? 0,
        total_tokens: body.usage.total_tokens ?? 0,
      });
    }

    const parsed = parseLipAgentToolCall(body);
    if (!parsed || !Array.isArray(parsed.agents)) return [];

    return parsed.agents.filter((item): item is LipAgentExtraction => {
      if (typeof item !== 'object' || item === null) return false;
      const c = item as Record<string, unknown>;
      return (
        typeof c.agent_name_raw === 'string' &&
        c.agent_name_raw.trim().length > 0 &&
        typeof c.agent_category === 'string' &&
        typeof c.measured_value_raw === 'string' &&
        typeof c.conclusion_excerpt === 'string' &&
        typeof c.source_excerpt === 'string' &&
        c.source_excerpt.trim().length > 0
      );
    });
  }
}
