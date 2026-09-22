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

// Latência medida do MiniMax-M3 (modelo de raciocínio): p95 ~40 s, cauda até ~57 s.
// O timeout cobre a cauda; cada tentativa tem o seu próprio.
const PROVIDER_TIMEOUT_MS = 75_000;
// Só vale repetir uma resposta inválida se a 1ª tentativa foi rápida: depois disso o
// usuário já esperou demais e a repetição empilharia outra espera longa.
const RETRY_MAX_ELAPSED_MS = 45_000;

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

  get modelName(): string {
    return process.env.MINIMAX_MODEL || 'MiniMax-M3';
  }

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

    const model = this.modelName;
    const requestBody = buildRagChatCompletionBody(
      model,
      question,
      chunks,
      operationalItems,
      companyChunks,
      checklistItems,
      attachment,
    );

    // As falhas de saída do modelo (tool call malformado, ausente ou cortado no
    // teto de tokens) são independentes entre chamadas: uma repetição resolve a
    // maioria. Só repete a saída inválida — erro de rede/timeout/HTTP continua
    // lançando na hora (requestOnce), e items: [] válido é resultado legítimo.
    const started = this.now();
    let { body, parsed } = await this.requestOnce(apiKey, requestBody);
    if (!parsed && this.now() - started < RETRY_MAX_ELAPSED_MS) {
      // Só metadados no log (nunca a pergunta nem parte da resposta do modelo:
      // dado de empresa/LGPD).
      this.logger.warn(
        `Assistente: 1ª tentativa sem tool call parseável (finish_reason=${body?.choices?.[0]?.finish_reason}, completion_tokens=${body?.usage?.completion_tokens}) — repetindo uma vez`,
      );
      ({ body, parsed } = await this.requestOnce(apiKey, requestBody));
    }

    if (!parsed) {
      // Tool call ausente ou inválido/truncado — só metadados no log (nunca a
      // pergunta nem parte da resposta do modelo: dado de empresa/LGPD).
      this.logger.warn(
        `Assistente: resposta do provedor sem tool call parseável (finish_reason=${body?.choices?.[0]?.finish_reason}, completion_tokens=${body?.usage?.completion_tokens}) — a pergunta cai no fallback`,
      );
      return [];
    }
    if (!Array.isArray(parsed.items)) return [];

    // checklist_ref_ids é um campo novo num fluxo já em produção, e alguns LLMs
    // omitem arrays vazios (mais provável em pergunta normativa pura, onde
    // nenhum item de checklist entra no prompt). Uma claim sem o campo não pode
    // gerar citação falsa, mas descartá-la mataria a resposta inteira (fallback
    // pra qualquer pergunta, em silêncio) — então normalizamos SÓ esse campo
    // para []; os demais seguem estritos.
    for (const item of parsed.items) {
      if (typeof item === 'object' && item !== null) {
        const candidate = item as Record<string, unknown>;
        if (!Array.isArray(candidate.checklist_ref_ids)) candidate.checklist_ref_ids = [];
      }
    }

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

  // Existe só para o teste controlar o relógio (jest.spyOn(service, 'now')).
  private now(): number {
    return Date.now();
  }

  // Uma ida ao provedor: fetch → tratamento de erro → JSON → log de uso → parse do
  // tool call. Cada resposta com `usage` entra no log (as duas tentativas custam
  // tokens). Falha de rede/timeout, HTTP não-ok e corpo não-JSON lançam
  // BadGatewayException; saída do modelo sem tool call parseável volta como
  // parsed === null (quem decide repetir é o chamador).
  private async requestOnce(apiKey: string, requestBody: unknown): Promise<{ body: any; parsed: { items?: unknown } | null }> {
    let response: Response;
    try {
      response = await fetch('https://api.minimax.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
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

    return { body, parsed: parseRagToolCall(body) };
  }
}
