import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DocumentClassification, DocumentClassifierProvider } from './document-classifier-provider.interface';
import { buildClassifyChatCompletionBody, parseClassifyToolCall, VALID_CATEGORIES } from './document-classifier-shared';

@Injectable()
export class MiniMaxDocumentClassifierService implements DocumentClassifierProvider {
  private readonly logger = new Logger(MiniMaxDocumentClassifierService.name);

  async classify(text: string): Promise<DocumentClassification> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Classificação de documentos ainda não está disponível');
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
        body: JSON.stringify(buildClassifyChatCompletionBody(model, text)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax (classificação de documento)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível classificar o documento agora');
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // best-effort — segue mesmo se não conseguir ler o corpo do erro
      }
      this.logger.error(`MiniMax retornou status ${response.status} (classificação de documento): ${errorBody}`);
      throw new BadGatewayException('Não foi possível classificar o documento agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do MiniMax não é JSON válido (classificação de documento)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível classificar o documento agora');
    }

    const parsed = parseClassifyToolCall(body);
    if (!parsed) {
      throw new BadGatewayException('Não foi possível classificar o documento agora');
    }

    const confidence = parsed.confidence === 'alta' ? 'alta' : 'baixa';
    const categoryValid = VALID_CATEGORIES.includes(parsed.category);
    return {
      category: confidence === 'alta' && categoryValid ? parsed.category : null,
      title: parsed.title.trim().length > 0 ? parsed.title.trim() : null,
      expires_at: /^\d{4}-\d{2}-\d{2}$/.test(parsed.expires_at) ? parsed.expires_at : null,
      confidence,
    };
  }
}
