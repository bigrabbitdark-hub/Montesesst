import { BadGatewayException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { ChecklistItemSuggestion, FieldReportExtractor } from './field-report-extractor.interface';
import { buildChatCompletionBody, filterValidSuggestions, parseChatCompletionToolCall } from './checklist-extraction-shared';

@Injectable()
export class MiniMaxExtractorService implements FieldReportExtractor {
  private readonly logger = new Logger(MiniMaxExtractorService.name);

  // @Inject(ClasseConcreta) explícito: mesma causa raiz do fix em
  // MiniMaxNormativeAnswerService / AiUsageLogService — sem isto, sob tsx
  // (esbuild não emite design:paramtypes), `this.aiConfig` chegaria undefined.
  constructor(@Inject(AiConfigService) private readonly aiConfig: AiConfigService) {}

  async extract(reportText: string): Promise<ChecklistItemSuggestion[]> {
    const { apiKey, model } = await this.aiConfig.getResolved('minimax');
    if (!apiKey) {
      throw new ServiceUnavailableException('Copiloto de IA ainda não está disponível');
    }

    let response: Response;
    try {
      response = await fetch('https://api.minimax.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildChatCompletionBody(model, reportText)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!response.ok) {
      this.logger.error(`MiniMax retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    const parsed = parseChatCompletionToolCall(body);
    if (!parsed) {
      this.logger.error('Resposta do MiniMax sem tool_call válido');
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    return filterValidSuggestions(parsed.items);
  }
}
