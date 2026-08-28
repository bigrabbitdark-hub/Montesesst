import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ChecklistItemSuggestion, FieldReportExtractor } from './field-report-extractor.interface';
import { buildChatCompletionBody, filterValidSuggestions, parseChatCompletionToolCall } from './checklist-extraction-shared';

// OpenRouter (openrouter.ai) — API compatível com o formato OpenAI, dá
// acesso a vários modelos (Claude, GPT, MiniMax etc.) por uma chave só. O
// fundador escolhe o modelo direto no painel/via OPENROUTER_MODEL, sem
// precisar de código novo pra trocar de provedor por trás do OpenRouter.
@Injectable()
export class OpenRouterExtractorService implements FieldReportExtractor {
  private readonly logger = new Logger(OpenRouterExtractorService.name);

  async extract(reportText: string): Promise<ChecklistItemSuggestion[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Copiloto de IA ainda não está disponível');
    }

    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://montesesst.com.br',
          'X-Title': 'Montese SST - Copiloto de IA',
        },
        body: JSON.stringify(buildChatCompletionBody(model, reportText)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    const parsed = parseChatCompletionToolCall(body);
    if (!parsed) {
      this.logger.error('Resposta do OpenRouter sem tool_call válido');
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    return filterValidSuggestions(parsed.items);
  }
}
