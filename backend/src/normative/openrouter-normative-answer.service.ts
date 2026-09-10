import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  AttachmentInput,
  CompanyChunk,
  NormativeAnswerProvider,
  NormativeClaim,
  OperationalItem,
} from './normative-answer-provider.interface';
import { buildRagChatCompletionBody, parseRagToolCall } from './normative-answer-shared';

@Injectable()
export class OpenRouterNormativeAnswerService implements NormativeAnswerProvider {
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  async answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
    companyChunks: CompanyChunk[],
    attachment?: AttachmentInput,
  ): Promise<NormativeClaim[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
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
          'X-Title': 'Montese SST - Assistente Normativo',
        },
        body: JSON.stringify(
          buildRagChatCompletionBody(model, question, chunks, operationalItems, companyChunks, attachment),
        ),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort — segue mesmo se não conseguir ler o corpo do erro
      }
      this.logger.error(`OpenRouter retornou status ${response.status} (assistente): ${errorBody}`);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    const parsed = parseRagToolCall(body);
    if (!parsed || !Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is NormativeClaim => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.claim === 'string' &&
        Array.isArray(candidate.chunk_ids) &&
        Array.isArray(candidate.operational_ref_ids) &&
        Array.isArray(candidate.company_chunk_ids) &&
        typeof candidate.uses_attachment === 'boolean'
      );
    });
  }
}
