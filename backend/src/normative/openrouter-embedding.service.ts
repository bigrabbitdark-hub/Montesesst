import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

// Mesmo padrão de OpenRouterExtractorService (Fase 8) — endpoint,
// headers e tratamento de erro idênticos, só a URL e o corpo mudam
// (embeddings em vez de chat completion).
@Injectable()
export class OpenRouterEmbeddingService implements EmbeddingProvider {
  private readonly logger = new Logger(OpenRouterEmbeddingService.name);

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
    }

    const model = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://montesesst.com.br',
          'X-Title': 'Montese SST - Assistente Normativo',
        },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter (embeddings)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status} (embeddings)`);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido (embeddings)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    const embedding = body?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      this.logger.error('Resposta do OpenRouter sem embedding válido');
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    return embedding;
  }
}
