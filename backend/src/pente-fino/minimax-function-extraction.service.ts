import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ExtractedFunctionItem, FunctionExtractionProvider } from './function-extraction-provider.interface';
import { buildExtractChatCompletionBody, parseExtractToolCall } from './function-extraction-shared';
import { AiUsageLogService } from '../common/ai-usage/ai-usage-log.service';

// Mesmo padrão de MiniMaxDocumentClassifierService (Fase 21) — só
// MiniMax implementado nesta fase (decisão do fundador), interface
// (FunctionExtractionProvider) garante trocabilidade futura via
// useClass sem precisar escrever a segunda implementação agora.
// Timeout de 60s (não 45s como classify/answer) porque a entrada é o
// documento inteiro (pode ser bem maior que uma pergunta ou um texto
// de classificação).
@Injectable()
export class MiniMaxFunctionExtractionService implements FunctionExtractionProvider {
  private readonly logger = new Logger(MiniMaxFunctionExtractionService.name);

  constructor(private readonly usageLog: AiUsageLogService) {}

  async extract(fullText: string, kind: 'risco' | 'exame'): Promise<ExtractedFunctionItem[]> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Extração de função ainda não está disponível');
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
        body: JSON.stringify(buildExtractChatCompletionBody(model, fullText, kind)),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax (extração de função)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair as funções agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort
      }
      this.logger.error(`MiniMax retornou status ${response.status} (extração de função): ${errorBody}`);
      throw new BadGatewayException('Não foi possível extrair as funções agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido (extração de função)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair as funções agora');
    }

    if (body?.usage) {
      await this.usageLog.log('pente_fino_extraction', {
        prompt_tokens: body.usage.prompt_tokens ?? 0,
        completion_tokens: body.usage.completion_tokens ?? 0,
        total_tokens: body.usage.total_tokens ?? 0,
      });
    }

    const parsed = parseExtractToolCall(body);
    if (!parsed || !Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is ExtractedFunctionItem => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.function_text === 'string' &&
        candidate.function_text.trim().length > 0 &&
        typeof candidate.description === 'string' &&
        candidate.description.trim().length > 0 &&
        typeof candidate.source_excerpt === 'string' &&
        candidate.source_excerpt.trim().length > 0
      );
    });
  }
}
