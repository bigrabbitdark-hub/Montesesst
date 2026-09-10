import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import {
  AttachmentInput,
  NORMATIVE_ANSWER_PROVIDER,
  NormativeAnswerProvider,
  OperationalItem,
} from './normative-answer-provider.interface';
import { toVectorLiteral } from '../common/vector/vector.util';
import { envFloat } from '../common/env';
import { DatabaseService } from '../common/database/database.service';
import { ATTENTION_TIPO_AI_SAFE, DashboardService } from '../dashboard/dashboard.service';
import { AuthenticatedUser } from '../common/types';
import { extractPdfText } from '../common/pdf/pdf-text.util';

const FALLBACK_MESSAGE = 'Não encontrei nada relevante pra essa pergunta.';
const PDF_UNREADABLE_WARNING =
  'Não consegui ler texto deste PDF (pode ser um documento escaneado sem texto real) — a resposta abaixo não considera o conteúdo do anexo.';

// Trechos normativos buscados por padrão, sem anexo — mesmo valor de
// sempre (Fase 9/10).
const CHUNK_LIMIT_DEFAULT = 6;
// Com anexo presente, reduz pra liberar orçamento de contexto pro
// conteúdo do documento/imagem anexado (Fase 20).
const CHUNK_LIMIT_WITH_ATTACHMENT = 3;

export interface NormativeQueryCitation {
  document_id: string;
  title: string;
  official_url: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
  // true quando alguma afirmação sobrevivente usou o anexo desta
  // pergunta como evidência (Fase 20) — omitido (undefined) quando não
  // há anexo ou nenhuma afirmação o usou.
  used_attachment?: boolean;
  // presente só quando um PDF foi anexado e não tinha texto real
  // extraível — a pergunta ainda é respondida com o que houver de
  // trechos normativos/itens operacionais, só sem considerar o anexo.
  attachment_warning?: string;
}

// Anexo bruto recebido do controller (multipart) — ainda não
// convertido pro formato que o answerer espera (isso é feito dentro
// de query(), que decide extrair texto de PDF ou converter imagem pra
// base64 dependendo do mimetype).
export interface QueryAttachment {
  buffer: Buffer;
  mimetype: string;
}

interface RetrievedChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  source_title: string;
  official_url: string;
  similarity: number;
}

@Injectable()
export class NormativeAssistantService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(NORMATIVE_ANSWER_PROVIDER) private readonly answerer: NormativeAnswerProvider,
    private readonly db: DatabaseService,
    private readonly dashboard: DashboardService,
  ) {}

  async query(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
  ): Promise<NormativeQueryResult> {
    let attachmentInput: AttachmentInput | undefined;
    let attachmentWarning: string | undefined;

    if (attachment) {
      if (attachment.mimetype === 'application/pdf') {
        const text = await extractPdfText(attachment.buffer);
        if (text) {
          attachmentInput = { kind: 'pdf_text', content: text };
        } else {
          attachmentWarning = PDF_UNREADABLE_WARNING;
        }
      } else {
        // image/jpeg ou image/png (únicos outros mimetypes aceitos pelo
        // controller) — sem extração, vai direto como bloco de imagem
        // pro modelo multimodal.
        attachmentInput = {
          kind: 'image',
          content: attachment.buffer.toString('base64'),
          mimeType: attachment.mimetype,
        };
      }
    }

    const questionEmbedding = await this.embeddings.embed(question);
    // 0.75 (valor original do plano) nunca teria funcionado de verdade —
    // calibrado contra as 38 NRs reais indexadas em 2026-08-31: pergunta
    // irrelevante ("capital da França") ~0.13, tangencial ("bolo de
    // chocolate") ~0.30, pergunta claramente respondida pela base
    // ("cinto de segurança em altura" -> NR-35) 0.63-0.67. `text-
    // embedding-3-small` não produz similaridade alta mesmo pra pares
    // pergunta/trecho genuinamente relevantes — 0.4 separa com folga dos
    // dois lados dessa amostra real.
    const threshold = envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.4);
    const chunkLimit = attachmentInput ? CHUNK_LIMIT_WITH_ATTACHMENT : CHUNK_LIMIT_DEFAULT;

    // `official_sources`, `normative_documents` e
    // `normative_document_chunks` não têm tenant_id nem RLS — não há
    // contexto de tenant a propagar aqui. Usar withoutTenantContext (só
    // pool.connect()/release(), sem BEGIN/COMMIT) garante que nenhuma
    // conexão do pool fica presa "idle in transaction" durante as
    // chamadas HTTP externas lentas (embed acima, answer abaixo) — ver
    // Finding C1a da revisão final da Fase 9.
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChunk>(
        `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.official_url,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM normative_document_chunks c
         JOIN normative_documents d ON d.id = c.document_id
         JOIN official_sources s ON s.id = d.source_id
         WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );
    const relevant = rows.filter((r) => r.similarity >= threshold);

    // Busca operacional só pra empresa, numa transação curta e SEPARADA
    // — mesma regra de nunca segurar conexão durante chamada de IA (ver
    // Finding C1a). Roda ANTES de chamar this.answerer.answer(...),
    // então não estende a janela de conexão aberta durante embedding/chat.
    // technico/parceiro: operationalItems fica [] sempre, comportamento
    // idêntico ao da Fase 9.
    let operationalItems: OperationalItem[] = [];
    if (user.role === 'empresa' && user.tenantId) {
      const tenantId = user.tenantId;
      const summary = await this.db.withTenantContext(
        { userId: user.id, tenantId, role: user.role },
        (client) => this.dashboard.getSummary(client, tenantId),
      );
      // Normaliza o texto antes de entrar no prompt — `titulo` vem de
      // AttentionItem, que embute texto controlado pelo usuário
      // (documents.title, tenant_epis.ca_number), gravável por
      // empresa/tecnico/parceiro. Sem isso, um título com quebra de
      // linha poderia forjar uma linha `[op-N] ...` extra que imita um
      // item real, ou tentar embutir uma instrução dentro do texto que
      // o modelo trata como dado (achado da revisão final da Fase 10).
      // Itens tipo:'cargo' (Fase 23) e tipo:'brigada_incendio' (integração
      // da brigada de incêndio no dashboard) contêm nome completo de
      // funcionário no título (`employee_name`/`employee_full_name`) — não
      // fazem sentido pro Assistente normativo responder pergunta nenhuma,
      // e a spec de ambas as fases exclui qualquer uso de IA sobre esse
      // dado. Filtrados antes de entrar no prompt, não só sanitizados —
      // não é suficiente sanitizar/truncar o texto, porque o nome completo
      // em si é o dado sensível, não formatação hostil (essa é tratada
      // separadamente, ver comentário acima sobre normalização de espaços/
      // quebras de linha).
      //
      // Isso já vazou PII duas vezes ('cargo', depois 'brigada_incendio')
      // porque o filtro era um denylist de manutenção manual: um
      // AttentionItem['tipo'] novo compilava de boa e, se ninguém lembrasse
      // de excluí-lo aqui, ia direto pro provedor de IA externo por padrão.
      // ATTENTION_TIPO_AI_SAFE (dashboard.service.ts) inverte isso pra um
      // allowlist tipado com `satisfies Record<AttentionItem['tipo'],
      // boolean>` — um tipo novo na union sem entrada explícita ali quebra
      // a COMPILAÇÃO do backend inteiro, não só silenciosamente vaza dado.
      operationalItems = summary.atencao
        .filter((item) => ATTENTION_TIPO_AI_SAFE[item.tipo])
        .map((item, i) => ({
          id: `op-${i}`,
          titulo: item.titulo.replace(/\s+/g, ' ').trim().slice(0, 200),
        }));
    }

    if (relevant.length === 0 && operationalItems.length === 0 && !attachmentInput) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [], attachment_warning: attachmentWarning };
    }

    const claims = await this.answerer.answer(
      question,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
      operationalItems,
      attachmentInput,
    );

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const validOperationalIds = new Set(operationalItems.map((o) => o.id));
    // `attachmentInput` (calculado no topo deste método) é a única fonte
    // de verdade sobre se um anexo de verdade foi processado com sucesso
    // nesta chamada — undefined tanto quando não veio nenhum arquivo
    // quanto quando veio um PDF sem texto extraível (aí quem é setado é
    // attachmentWarning, não attachmentInput). `claim.uses_attachment` é
    // um campo que o modelo de IA preenche livremente, então nunca pode
    // por si só provar que existe uma fonte real — sem este guard, uma
    // pergunta sem anexo (ou com PDF ilegível) que alucinasse
    // `uses_attachment: true` junto de chunk_ids/operational_ref_ids
    // vazios passaria pelo Verificador sem ter citado fonte nenhuma
    // (achado da revisão final da Fase 20 — o bug só existe na costura
    // entre a extração de anexo, no topo do método, e este filtro).
    const attachmentIsReal = attachmentInput !== undefined;
    // Regra exata (ver Global Constraints do plano): uma afirmação com
    // as duas listas vazias E uses_attachment (real) false é descartada
    // mesmo que nenhuma das duas contenha um id inválido — every() sobre
    // array vazio dá true em JS, então "tem pelo menos uma fonte" é
    // checado à parte, nunca inferido só das duas every().
    const survivingClaims = claims.filter((claim) => {
      const hasSource =
        claim.chunk_ids.length > 0 ||
        claim.operational_ref_ids.length > 0 ||
        (attachmentIsReal && claim.uses_attachment === true);
      return (
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id))
      );
    });

    if (survivingClaims.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [], attachment_warning: attachmentWarning };
    }

    const usedChunkIds = new Set(survivingClaims.flatMap((c) => c.chunk_ids));
    const citationsByDocument = new Map<string, NormativeQueryCitation>();
    for (const chunk of relevant) {
      if (usedChunkIds.has(chunk.chunk_id)) {
        citationsByDocument.set(chunk.document_id, {
          document_id: chunk.document_id,
          title: chunk.source_title,
          official_url: chunk.official_url,
        });
      }
    }

    const usedAttachment = attachmentIsReal && survivingClaims.some((c) => c.uses_attachment);

    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
      used_attachment: usedAttachment ? true : undefined,
      attachment_warning: attachmentWarning,
    };
  }
}
