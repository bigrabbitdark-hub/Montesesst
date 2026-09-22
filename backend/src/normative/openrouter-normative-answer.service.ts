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

@Injectable()
export class OpenRouterNormativeAnswerService implements NormativeAnswerProvider {
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  get modelName(): string {
    return process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
  }

  async answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
    companyChunks: CompanyChunk[],
    checklistItems: ChecklistItem[],
    attachment?: AttachmentInput,
  ): Promise<NormativeClaim[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
    }

    const model = this.modelName;
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
          buildRagChatCompletionBody(model, question, chunks, operationalItems, companyChunks, checklistItems, attachment),
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
}
