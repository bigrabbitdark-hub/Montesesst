import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import {
  AttachmentInput,
  CompanyChunk,
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
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { detectNotices, NormativeNotice } from './question-notices';
import { checkClaimSupport } from './claim-support';

const FALLBACK_MESSAGE =
  'Não encontrei fundamento suficiente nas fontes consultadas para afirmar isso. Isso não significa que a exigência não exista, só que não a localizei.';
const PDF_UNREADABLE_WARNING =
  'Não consegui ler texto deste PDF (pode ser um documento escaneado sem texto real) — a resposta abaixo não considera o conteúdo do anexo.';
const DOCX_UNREADABLE_WARNING =
  'Não consegui ler texto deste DOCX (pode estar corrompido) — a resposta abaixo não considera o conteúdo do anexo.';
const XLSX_UNREADABLE_WARNING =
  'Não consegui ler linhas desta planilha (pode estar corrompida ou vazia) — a resposta abaixo não considera o conteúdo do anexo.';

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

export interface CompanyDocumentCitation {
  document_id: string;
  title: string;
  category: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
  company_citations: CompanyDocumentCitation[];
  // Avisos determinísticos por pergunta (question-notices.ts) — sempre
  // presente, possivelmente vazio; nunca bloqueia a resposta.
  notices: NormativeNotice[];
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
  source_code: string | null;
  official_url: string;
  similarity: number;
}

interface RetrievedCompanyChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  category: string;
  document_title: string;
  similarity: number;
}

@Injectable()
export class NormativeAssistantService {
  private readonly logger = new Logger(NormativeAssistantService.name);

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
    tenantId?: string,
  ): Promise<NormativeQueryResult> {
    // Avisos determinísticos (sem I/O, sem custo) — calculados antes de
    // qualquer embedding/busca e devolvidos em todos os caminhos de retorno.
    const notices = detectNotices(question);

    // `tenantId` aqui é o ALVO (de qual empresa buscar dado operacional
    // e documento) — pra empresa é sempre o próprio `user.tenantId`; pra
    // técnico/parceiro vem do corpo da requisição (opcional: sem ele, a
    // pergunta continua puramente normativa, igual ao comportamento de
    // sempre). Checagem de vínculo ANTES de qualquer embedding/chamada de
    // IA — mesmo padrão do Pente-Fino/dashboard summary — pra não gastar
    // custo numa pergunta que vai ser rejeitada de qualquer forma.
    if (tenantId && user.role !== 'empresa') {
      await this.db.withTenantContext(
        { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
        (client) => this.dashboard.assertTenantLinked(client, tenantId),
      );
    }

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
      } else if (attachment.mimetype === DOCX_MIME_TYPE) {
        const text = await extractDocxText(attachment.buffer);
        if (text) {
          attachmentInput = { kind: 'docx_text', content: text };
        } else {
          attachmentWarning = DOCX_UNREADABLE_WARNING;
        }
      } else if (attachment.mimetype === XLSX_MIME_TYPE) {
        const rows = await extractXlsxRows(attachment.buffer);
        if (rows.length > 0) {
          attachmentInput = { kind: 'xlsx_text', content: rows.join('\n') };
        } else {
          attachmentWarning = XLSX_UNREADABLE_WARNING;
        }
      } else {
        // image/jpeg ou image/png (únicos outros mimetypes aceitos pelo
        // controller além de PDF/DOCX/XLSX) — sem extração, vai direto
        // como bloco de imagem pro modelo multimodal.
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
        `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.code AS source_code, s.official_url,
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

    // Busca operacional, numa transação curta e SEPARADA — mesma regra
    // de nunca segurar conexão durante chamada de IA (ver Finding C1a).
    // Roda ANTES de chamar this.answerer.answer(...), então não estende
    // a janela de conexão aberta durante embedding/chat. `tenantId` já
    // veio validado (vínculo checado acima pra técnico/parceiro; pra
    // empresa é sempre o próprio tenant) — sem ele, fica vazio (pergunta
    // puramente normativa).
    let operationalItems: OperationalItem[] = [];
    if (tenantId) {
      const summary = await this.db.withTenantContext(
        { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
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

    // Busca de trechos de documento da própria empresa (PGR/PCMSO/LTCAT/
    // LIP, Fase 24) — mesma condição do bloco operacional acima: roda
    // sempre que houver um `tenantId` já validado. Transação curta e
    // separada, mesma regra de nunca segurar conexão durante chamada de
    // IA (ver Finding C1a acima).
    let companyChunks: RetrievedCompanyChunk[] = [];
    if (tenantId) {
      const { rows: companyRows } = await this.db.withTenantContext(
        { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
        (client) =>
          client.query<RetrievedCompanyChunk>(
            `SELECT c.id AS chunk_id, c.content, c.document_id, c.category, d.title AS document_title,
                    1 - (c.embedding <=> $1::vector) AS similarity
             FROM company_document_chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE c.tenant_id = $2
             ORDER BY c.embedding <=> $1::vector
             LIMIT $3`,
            [toVectorLiteral(questionEmbedding), tenantId, chunkLimit],
          ),
      );
      companyChunks = companyRows.filter((r) => r.similarity >= threshold);
    }

    if (relevant.length === 0 && operationalItems.length === 0 && companyChunks.length === 0 && !attachmentInput) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        notices,
        attachment_warning: attachmentWarning,
      };
    }

    const claims = await this.answerer.answer(
      question,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
      operationalItems,
      companyChunks.map((c): CompanyChunk => ({ id: c.chunk_id, content: c.content })),
      attachmentInput,
    );

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const validOperationalIds = new Set(operationalItems.map((o) => o.id));
    const validCompanyChunkIds = new Set(companyChunks.map((c) => c.chunk_id));
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
    // Evidência textual de cada fonte que uma claim pode citar, para o
    // Verificador v2 (claim-support.ts). O chunk normativo entra precedido do
    // código e do título da fonte ("NR-35 …"): o texto de um chunk nem
    // sempre repete o nome da norma, e sem isso "conforme a NR-35" seria
    // bloqueado indevidamente. Anexo de imagem não tem texto verificável.
    const chunkEvidence = new Map<string, string>(
      relevant.map((r): [string, string] => [r.chunk_id, `${r.source_code ?? ''} ${r.source_title}\n${r.content}`]),
    );
    const operationalEvidence = new Map<string, string>(
      operationalItems.map((o): [string, string] => [o.id, o.titulo]),
    );
    const companyEvidence = new Map<string, string>(
      companyChunks.map((c): [string, string] => [c.chunk_id, `${c.document_title}\n${c.content}`]),
    );
    const attachmentText =
      attachmentInput && attachmentInput.kind !== 'image' ? attachmentInput.content : undefined;

    const survivingClaims = claims.filter((claim) => {
      const hasSource =
        claim.chunk_ids.length > 0 ||
        claim.operational_ref_ids.length > 0 ||
        claim.company_chunk_ids.length > 0 ||
        (attachmentIsReal && claim.uses_attachment === true);
      const idsAreValid =
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id)) &&
        claim.company_chunk_ids.every((id) => validCompanyChunkIds.has(id));
      if (!idsAreValid) return false;

      const evidenceTexts = [
        ...claim.chunk_ids.map((id) => chunkEvidence.get(id) as string),
        ...claim.operational_ref_ids.map((id) => operationalEvidence.get(id) as string),
        ...claim.company_chunk_ids.map((id) => companyEvidence.get(id) as string),
      ];
      if (attachmentText && attachmentIsReal && claim.uses_attachment === true) {
        evidenceTexts.push(attachmentText);
      }

      const support = checkClaimSupport(claim.claim, evidenceTexts);
      // Registro sem o texto da pergunta nem da claim (dados de empresa,
      // LGPD): só ids das fontes citadas e os tokens sinalizados.
      const citedIds = [...claim.chunk_ids, ...claim.operational_ref_ids, ...claim.company_chunk_ids];
      if (support.logged.length > 0) {
        this.logger.warn(
          `Número com unidade sem base nas fontes citadas (só registrado): ${support.logged.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
      }
      if (support.blocking.length > 0) {
        this.logger.warn(
          `Claim descartada — item/NR sem base nas fontes citadas: ${support.blocking.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
        return false;
      }
      return true;
    });

    if (survivingClaims.length === 0) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        notices,
        attachment_warning: attachmentWarning,
      };
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

    const usedCompanyChunkIds = new Set(survivingClaims.flatMap((c) => c.company_chunk_ids));
    const companyCitationsByDocument = new Map<string, CompanyDocumentCitation>();
    for (const chunk of companyChunks) {
      if (usedCompanyChunkIds.has(chunk.chunk_id)) {
        companyCitationsByDocument.set(chunk.document_id, {
          document_id: chunk.document_id,
          title: chunk.document_title,
          category: chunk.category,
        });
      }
    }

    const usedAttachment = attachmentIsReal && survivingClaims.some((c) => c.uses_attachment);

    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
      company_citations: Array.from(companyCitationsByDocument.values()),
      notices,
      used_attachment: usedAttachment ? true : undefined,
      attachment_warning: attachmentWarning,
    };
  }
}
