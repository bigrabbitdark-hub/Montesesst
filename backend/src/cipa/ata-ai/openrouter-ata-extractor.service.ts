import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AtaDraftFields, AtaExtractor } from './ata-extractor.interface';
import { buildChatCompletionBody, parseChatCompletionToolCall, toAtaDraftFields } from './ata-extraction-shared';

@Injectable()
export class OpenRouterAtaExtractorService implements AtaExtractor {
  private readonly logger = new Logger(OpenRouterAtaExtractorService.name);

  async extract(transcript: string): Promise<AtaDraftFields> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Geração de rascunho de ata ainda não está disponível');
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
          'X-Title': 'Montese SST - CIPA Ata IA',
        },
        body: JSON.stringify(buildChatCompletionBody(model, transcript)),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    const parsed = parseChatCompletionToolCall(body);
    if (!parsed) {
      this.logger.error('Resposta do OpenRouter sem tool_call válido');
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    return toAtaDraftFields(parsed);
  }
}
