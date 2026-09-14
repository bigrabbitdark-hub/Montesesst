import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DocumentChecklistExtraction,
  DocumentChecklistExtractionProvider,
} from './document-checklist-provider.interface';
import { buildDocumentChecklistChatCompletionBody, parseDocumentChecklistToolCall } from './document-checklist-shared';
import { AiUsageLogService } from '../common/ai-usage/ai-usage-log.service';

// Mesmo padrão de MiniMaxFunctionExtractionService (Fase 25) — só
// MiniMax implementado nesta fase, interface
// (DocumentChecklistExtractionProvider) garante trocabilidade futura.
// Timeout de 60s pelo mesmo motivo: a entrada é o documento inteiro.
@Injectable()
export class MiniMaxDocumentChecklistService implements DocumentChecklistExtractionProvider {
  private readonly logger = new Logger(MiniMaxDocumentChecklistService.name);

  constructor(private readonly usageLog: AiUsageLogService) {}

  async extract(fullText: string): Promise<DocumentChecklistExtraction> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Extração de checklist ainda não está disponível');
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
        body: JSON.stringify(buildDocumentChecklistChatCompletionBody(model, fullText)),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax (extração de checklist)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair o checklist agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort
      }
      this.logger.error(`MiniMax retornou status ${response.status} (extração de checklist): ${errorBody}`);
      throw new BadGatewayException('Não foi possível extrair o checklist agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido (extração de checklist)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível extrair o checklist agora');
    }

    if (body?.usage) {
      await this.usageLog.log('pente_fino_document_checklist', {
        prompt_tokens: body.usage.prompt_tokens ?? 0,
        completion_tokens: body.usage.completion_tokens ?? 0,
        total_tokens: body.usage.total_tokens ?? 0,
      });
    }

    const parsed = parseDocumentChecklistToolCall(body);
    if (!parsed) {
      throw new BadGatewayException('Resposta inesperada da extração de checklist');
    }

    return {
      elaboration_date: typeof parsed.elaboration_date === 'string' ? parsed.elaboration_date : '',
      elaboration_date_excerpt: typeof parsed.elaboration_date_excerpt === 'string' ? parsed.elaboration_date_excerpt : '',
      professional_name: typeof parsed.professional_name === 'string' ? parsed.professional_name : '',
      professional_registro: typeof parsed.professional_registro === 'string' ? parsed.professional_registro : '',
      professional_papel: typeof parsed.professional_papel === 'string' ? parsed.professional_papel : '',
      professional_excerpt: typeof parsed.professional_excerpt === 'string' ? parsed.professional_excerpt : '',
    };
  }
}
