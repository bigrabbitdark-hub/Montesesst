import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  AttachmentInput,
  ChecklistItem,
  CompanyChunk,
  NormativeAnswerProvider,
  NormativeClaim,
  OperationalItem,
} from './normative-answer-provider.interface';
import { buildRagChatCompletionBody, parseRagToolCall } from './normative-answer-shared';
import { AiUsageLogService } from '../common/ai-usage/ai-usage-log.service';

// Espelha OpenRouterNormativeAnswerService — mesmo formato OpenAI-compatible
// de chat completions com tool calling, reaproveitando o mesmo
// buildRagChatCompletionBody/parseRagToolCall. MINIMAX_MODEL precisa ser
// MiniMax-M3 (ou outro modelo MiniMax multimodal) para o caminho de anexo
// de imagem funcionar — é o único modelo MiniMax com suporte a image_url
// hoje (ver docs/assistente-montese-principios.md).
@Injectable()
export class MiniMaxNormativeAnswerService implements NormativeAnswerProvider {
  private readonly logger = new Logger(MiniMaxNormativeAnswerService.name);

  constructor(private readonly usageLog: AiUsageLogService) {}

  async answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
    companyChunks: CompanyChunk[],
    checklistItems: ChecklistItem[],
    attachment?: AttachmentInput,
  ): Promise<NormativeClaim[]> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
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
        body: JSON.stringify(
          buildRagChatCompletionBody(model, question, chunks, operationalItems, companyChunks, checklistItems, attachment),
        ),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort — segue mesmo se não conseguir ler o corpo do erro
      }
      this.logger.error(`MiniMax retornou status ${response.status} (assistente): ${errorBody}`);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    if (body?.usage) {
      await this.usageLog.log('assistant_normative_query', {
        prompt_tokens: body.usage.prompt_tokens ?? 0,
        completion_tokens: body.usage.completion_tokens ?? 0,
        total_tokens: body.usage.total_tokens ?? 0,
      });
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
        Array.isArray(candidate.checklist_ref_ids) &&
        typeof candidate.uses_attachment === 'boolean'
      );
    });
  }
}
