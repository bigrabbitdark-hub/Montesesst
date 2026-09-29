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

// Timeout total por tentativa (mesmo valor de sempre deste provedor —
// nunca medido em produção real porque o fallback está inativo, ver
// normative.module.ts).
const PROVIDER_TIMEOUT_MS = 45_000;
// Achado da auditoria do Assistente (2026-09-28, item 015): o MiniMax
// (provedor ativo) repete a chamada uma vez quando o tool call vem
// ausente/inválido, e só se a 1ª tentativa foi rápida — sem isso, este
// fallback regrediria em silêncio se um dia fosse reativado (troca de
// `useClass` em normative.module.ts). Mesma proporção do MiniMax (60% do
// timeout total: 45s/75s lá, aqui 27s/45s) — proporcional, não medido,
// porque este provedor não tem tráfego real hoje para calibrar de verdade.
const RETRY_MAX_ELAPSED_MS = 27_000;

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
    systemPrompt?: string,
  ): Promise<NormativeClaim[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
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
      systemPrompt,
    );

    // Mesma lógica do MiniMax (ver minimax-normative-answer.service.ts): só
    // repete saída inválida do modelo, nunca erro de rede/HTTP (esses
    // lançam direto em requestOnce).
    const started = this.now();
    let { body, parsed } = await this.requestOnce(apiKey, requestBody);
    if (!parsed && this.now() - started < RETRY_MAX_ELAPSED_MS) {
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
      // Fase A — Etapa 2: validar enums dos campos opcionais kind/confidence/scope.
      // Quando o modelo devolveu um valor inválido, o parser já vai aplicar o
      // default — então aceitar aqui qualquer string é seguro. Só bloqueamos
      // tipos errados (number, object, etc.).
      const okKind = !('kind' in candidate) || typeof candidate.kind === 'string';
      const okConfidence = !('confidence' in candidate) || typeof candidate.confidence === 'string';
      const okScope = !('scope' in candidate) || typeof candidate.scope === 'string';
      return (
        typeof candidate.claim === 'string' &&
        Array.isArray(candidate.chunk_ids) &&
        Array.isArray(candidate.operational_ref_ids) &&
        Array.isArray(candidate.company_chunk_ids) &&
        typeof candidate.uses_attachment === 'boolean' &&
        okKind &&
        okConfidence &&
        okScope
      );
    });
  }

  // Existe só para o teste controlar o relógio (jest.spyOn(service, 'now')),
  // mesmo padrão de minimax-normative-answer.service.ts.
  private now(): number {
    return Date.now();
  }

  private async requestOnce(apiKey: string, requestBody: unknown): Promise<{ body: any; parsed: { items?: unknown } | null }> {
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
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
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

    return { body, parsed: parseRagToolCall(body) };
  }
}
