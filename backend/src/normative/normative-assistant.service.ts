import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import {
  AttachmentInput,
  ChecklistItem,
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
import { QueryOutcome, QueryTrace, hashQuestion, tokensAllowedForClaim } from './query-trace';
import { AssistantQueryLogService } from './assistant-query-log.service';
import { isEpiQuestion } from './epi-by-function';
import { redactPii } from '../common/text/pii-redaction.util';
import { SYSTEM_PROMPT_WITH_EPI_GUIDE } from './normative-answer-shared';

// Fase 10 — copy ajustada pra ser direta e não sugerir que o assistente
// está fazendo afirmação categórica (pede verificação humana em vez disso).
const FALLBACK_MESSAGE =
  'Não encontrei nada relevante pra essa pergunta.';
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

export interface ChecklistItemCitation {
  item_id: string;
  nr_code: string;
  document_name: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
  company_citations: CompanyDocumentCitation[];
  // Itens do checklist interno de documentação SST (curadoria da
  // Montese, nunca texto oficial da norma) usados nesta resposta —
  // sempre presente (array, nunca omitido), mesmo padrão de `citations`/
  // `company_citations`.
  checklist_citations: ChecklistItemCitation[];
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

export interface RetrievedChunk {
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

export interface RetrievedChecklistItem {
  item_id: string;
  nr_code: string;
  document_name: string;
  content: string;
  similarity: number;
}

// Resultado da busca de referência (normas oficiais + checklist interno), com os
// candidatos do topo ANTES do corte pelo limiar de similaridade.
export interface ReferenceSearch {
  normativeRows: RetrievedChunk[];
  checklistRows: RetrievedChecklistItem[];
}

export interface ReferenceRetrieval extends ReferenceSearch {
  threshold: number;
  chunkLimit: number;
}

export interface TracedQueryResult {
  result: NormativeQueryResult;
  trace: QueryTrace;
}

@Injectable()
export class NormativeAssistantService {
  private readonly logger = new Logger(NormativeAssistantService.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(NORMATIVE_ANSWER_PROVIDER) private readonly answerer: NormativeAnswerProvider,
    // @Inject(ClasseConcreta) explícito nestes 3 (a própria classe já é o
    // token, diferente de embeddings/answerer acima, que são interface e
    // por isso usam @Inject(TOKEN)): sem isto, o Nest resolve o parâmetro
    // lendo o metadado design:paramtypes que o TypeScript emite via
    // emitDecoratorMetadata — funciona sob nest build/tsc (produção e2e),
    // mas o esbuild por trás do tsx NÃO emite esse metadado (limitação
    // conhecida e antiga do esbuild), então os 3 chegavam `undefined` ao
    // rodar via tsx (achado do runner de avaliação, Task 8 — primeiro
    // script do repo a subir o AppModule inteiro pelo container de DI do
    // Nest fora do bootstrap HTTP). Comportamento idêntico em produção.
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(AssistantQueryLogService) private readonly queryLog: AssistantQueryLogService,
  ) {}

  // Mesma assinatura e mesmo retorno de sempre. Além de responder, grava o trace
  // no log de uso (só metadados e ids) — sem esperar e sem nunca derrubar a
  // resposta: record() captura qualquer erro.
  async query(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
    tenantId?: string,
  ): Promise<NormativeQueryResult> {
    const { result, trace } = await this.queryWithTrace(question, user, attachment, tenantId);
    void this.queryLog.record(trace);
    return result;
  }

  // Só a recuperação de referência (embedding + busca), SEM tenant e SEM LLM de
  // resposta — a Camada A do runner de avaliação mede exatamente isto.
  async retrieve(question: string, chunkLimit: number = CHUNK_LIMIT_DEFAULT): Promise<ReferenceRetrieval> {
    const embedding = await this.embeddings.embed(question);
    const search = await this.searchReference(embedding, chunkLimit);
    return { ...search, threshold: this.ragThreshold(), chunkLimit };
  }

  // O pipeline completo, devolvendo também o trace (recuperação, verificador,
  // avisos). Não persiste nada.
  async queryWithTrace(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
    tenantId?: string,
  ): Promise<TracedQueryResult> {
    // Avisos determinísticos (sem I/O, sem custo) — calculados antes de
    // qualquer embedding/busca e devolvidos em todos os caminhos de retorno.
    const notices = detectNotices(question);

    // Estado do trace, preenchido nos pontos onde cada dado nasce. O trace NUNCA
    // carrega texto de pergunta, claim ou resposta — só ids, similaridades e
    // contagens (ver query-trace.ts).
    const startedAt = Date.now();
    let retrievalStartedAt = startedAt;
    const traceState = {
      usedAttachment: false,
      threshold: 0,
      chunkLimit: 0,
      normative: [] as QueryTrace['normative'],
      checklist: [] as QueryTrace['checklist'],
      company: [] as QueryTrace['company'],
      operationalCount: 0,
      claimsTotal: 0,
      claimsDroppedIds: 0,
      claimsDroppedSupport: 0,
      blockingTokens: [] as string[],
      flaggedNumbers: [] as string[],
      keptClaims: [] as QueryTrace['kept_claims'],
      retrievalMs: 0,
    };
    const finish = (result: NormativeQueryResult, outcome: QueryOutcome): TracedQueryResult => ({
      result,
      trace: {
        question_hash: hashQuestion(question),
        role: user.role,
        tenant_id: tenantId ?? null,
        threshold: traceState.threshold,
        chunk_limit: traceState.chunkLimit,
        normative: traceState.normative,
        checklist: traceState.checklist,
        company: traceState.company,
        operational_count: traceState.operationalCount,
        claims_total: traceState.claimsTotal,
        claims_dropped_ids: traceState.claimsDroppedIds,
        claims_dropped_support: traceState.claimsDroppedSupport,
        blocking_tokens: traceState.blockingTokens,
        flagged_numbers: traceState.flaggedNumbers,
        kept_claims: traceState.keptClaims,
        notices: notices.map((notice) => notice.tipo),
        outcome,
        used_attachment: traceState.usedAttachment,
        model: this.answerer.modelName ?? null,
        latency_ms: Date.now() - startedAt,
        retrieval_ms: traceState.retrievalMs,
      },
    });

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

    // Achado da auditoria do Assistente (2026-09-28, C-5): redactPii já
    // protegia o texto de documento indexado (Fase 24) e a transcrição de
    // ata de CIPA, mas NUNCA a pergunta digitada aqui nem o texto do anexo
    // desta própria pergunta — as duas coisas saem pro provedor externo
    // (embedding + chat completion) sem nenhuma minimização de PII. Um CPF
    // ou nome de terceiro colado na pergunta ia direto pro MiniMax/
    // OpenRouter. knownFullNames só é buscado quando há tenantId (mesma
    // query de documents.controller.ts, transação própria e curta, sem
    // custo extra numa pergunta puramente normativa); CPF é sempre
    // redigido, com ou sem tenant. `question`/`attachment.buffer`
    // originais continuam intactos pra detectNotices/hashQuestion (rodam
    // só localmente, nunca saem do backend) — só o que vai pro provedor
    // externo passa pela redação.
    let knownFullNames: string[] = [];
    if (tenantId) {
      knownFullNames = await this.db.withTenantContext(
        { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
        (client) =>
          client
            .query<{ full_name: string }>('SELECT full_name FROM employees WHERE tenant_id = $1', [tenantId])
            .then((res) => res.rows.map((row) => row.full_name)),
      );
    }
    const redactedQuestion = redactPii(question, knownFullNames);

    let attachmentInput: AttachmentInput | undefined;
    let attachmentWarning: string | undefined;

    if (attachment) {
      if (attachment.mimetype === 'application/pdf') {
        const text = await extractPdfText(attachment.buffer);
        if (text) {
          attachmentInput = { kind: 'pdf_text', content: redactPii(text, knownFullNames) };
        } else {
          attachmentWarning = PDF_UNREADABLE_WARNING;
        }
      } else if (attachment.mimetype === DOCX_MIME_TYPE) {
        const text = await extractDocxText(attachment.buffer);
        if (text) {
          attachmentInput = { kind: 'docx_text', content: redactPii(text, knownFullNames) };
        } else {
          attachmentWarning = DOCX_UNREADABLE_WARNING;
        }
      } else if (attachment.mimetype === XLSX_MIME_TYPE) {
        const rows = await extractXlsxRows(attachment.buffer);
        if (rows.length > 0) {
          attachmentInput = { kind: 'xlsx_text', content: redactPii(rows.join('\n'), knownFullNames) };
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

    traceState.usedAttachment = attachmentInput !== undefined;
    retrievalStartedAt = Date.now();
    // redactedQuestion (não `question`): o embedding também é uma chamada
    // externa (OpenRouter) — ver comentário do achado C-5 acima.
    const questionEmbedding = await this.embeddings.embed(redactedQuestion);
    // 0.75 (valor original do plano) nunca teria funcionado de verdade —
    // calibrado contra as 38 NRs reais indexadas em 2026-08-31: pergunta
    // irrelevante ("capital da França") ~0.13, tangencial ("bolo de
    // chocolate") ~0.30, pergunta claramente respondida pela base
    // ("cinto de segurança em altura" -> NR-35) 0.63-0.67. `text-
    // embedding-3-small` não produz similaridade alta mesmo pra pares
    // pergunta/trecho genuinamente relevantes — 0.4 separa com folga dos
    // dois lados dessa amostra real.
    const threshold = this.ragThreshold();
    const chunkLimit = attachmentInput ? CHUNK_LIMIT_WITH_ATTACHMENT : CHUNK_LIMIT_DEFAULT;

    const { normativeRows, checklistRows } = await this.searchReference(questionEmbedding, chunkLimit);
    const relevant = normativeRows.filter((r) => r.similarity >= threshold);
    const relevantChecklist = checklistRows.filter((r) => r.similarity >= threshold);
    traceState.threshold = threshold;
    traceState.chunkLimit = chunkLimit;
    traceState.normative = normativeRows.map((r) => ({
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      source_code: r.source_code,
      similarity: r.similarity,
      passed_threshold: r.similarity >= threshold,
    }));
    traceState.checklist = checklistRows.map((r) => ({
      item_id: r.item_id,
      nr_code: r.nr_code,
      similarity: r.similarity,
      passed_threshold: r.similarity >= threshold,
    }));

    // Busca operacional, numa transação curta e SEPARADA — mesma regra
    // de nunca segurar conexão durante chamada de IA (ver Finding C1a).
    // Roda ANTES de chamar this.answerer.answer(...), então não estende
    // a janela de conexão aberta durante embedding/chat. `tenantId` já
    // veio validado (vínculo checado acima pra técnico/parceiro; pra
    // empresa é sempre o próprio tenant) — sem ele, fica vazio (pergunta
    // puramente normativa).
    // Fase 10 — busca operacional SÓ pra role `empresa` (Restrição
    // Global §1 / spec §1): tecnico/parceiro continuam com tenantId
    // válido pra queries de documentos/NR/checklist, mas NÃO veem
    // pendências operacionais. ATTENTION_TIPO_AI_SAFE abaixo (allowlist
    // tipado em dashboard.service.ts) continua protegendo PII mesmo no
    // caminho empresa.
    let operationalItems: OperationalItem[] = [];
    if (tenantId && user.role === 'empresa') {
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

    traceState.operationalCount = operationalItems.length;

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
      traceState.company = companyRows.map((r) => ({
        similarity: r.similarity,
        passed_threshold: r.similarity >= threshold,
      }));
    }

    traceState.retrievalMs = Date.now() - retrievalStartedAt;

    if (
      relevant.length === 0 &&
      operationalItems.length === 0 &&
      companyChunks.length === 0 &&
      relevantChecklist.length === 0 &&
      !attachmentInput
    ) {
      return finish(
        {
          answer: null,
          message: FALLBACK_MESSAGE,
          citations: [],
          company_citations: [],
          checklist_citations: [],
          notices,
          attachment_warning: attachmentWarning,
        },
        'fallback_sem_evidencia',
      );
    }

    const claims = await this.answerer.answer(
      // redactedQuestion (não `question`): ver achado C-5 acima — é a
      // pergunta que efetivamente sai pro MiniMax/OpenRouter.
      redactedQuestion,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
      operationalItems,
      companyChunks.map((c): CompanyChunk => ({ id: c.chunk_id, content: c.content })),
      relevantChecklist.map((c): ChecklistItem => ({ id: c.item_id, content: c.content })),
      attachmentInput,
      // Achado da auditoria do Assistente (2026-09-28, C-3): este 7º
      // argumento nunca era passado — SYSTEM_PROMPT_WITH_EPI_GUIDE existia
      // desde a Fase A/Etapa 2 mas era código morto. undefined aqui faz o
      // provedor cair no SYSTEM_PROMPT padrão (mesmo comportamento de
      // sempre para pergunta que não é sobre EPI).
      isEpiQuestion(question) ? SYSTEM_PROMPT_WITH_EPI_GUIDE : undefined,
    );
    traceState.claimsTotal = claims.length;

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const validOperationalIds = new Set(operationalItems.map((o) => o.id));
    const validCompanyChunkIds = new Set(companyChunks.map((c) => c.chunk_id));
    const validChecklistIds = new Set(relevantChecklist.map((c) => c.item_id));
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
    // O checklist entra como evidência do Verificador v2 pelo mesmo
    // `content` que o modelo leu no prompt (NR + documento + descrição +
    // requisito legal). Sem isso o Verificador não checaria as NRs/itens
    // citados contra o texto do checklist: numa claim só de checklist a
    // lista de evidências ficaria vazia e checkClaimSupport não bloquearia
    // nada (NR inventada passaria); numa claim mista, uma NR/item que só o
    // checklist contém seria bloqueado como "sem base nas fontes citadas".
    const checklistEvidence = new Map<string, string>(
      relevantChecklist.map((c): [string, string] => [c.item_id, c.content]),
    );
    const attachmentText =
      attachmentInput && attachmentInput.kind !== 'image' ? attachmentInput.content : undefined;

    const survivingClaims = claims.filter((claim) => {
      const hasSource =
        claim.chunk_ids.length > 0 ||
        claim.operational_ref_ids.length > 0 ||
        claim.company_chunk_ids.length > 0 ||
        claim.checklist_ref_ids.length > 0 ||
        (attachmentIsReal && claim.uses_attachment === true);
      const idsAreValid =
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id)) &&
        claim.company_chunk_ids.every((id) => validCompanyChunkIds.has(id)) &&
        claim.checklist_ref_ids.every((id) => validChecklistIds.has(id));
      if (!idsAreValid) {
        traceState.claimsDroppedIds += 1;
        return false;
      }

      const evidenceTexts = [
        ...claim.chunk_ids.map((id) => chunkEvidence.get(id) as string),
        ...claim.operational_ref_ids.map((id) => operationalEvidence.get(id) as string),
        ...claim.company_chunk_ids.map((id) => companyEvidence.get(id) as string),
        ...claim.checklist_ref_ids.map((id) => checklistEvidence.get(id) as string),
      ];
      if (attachmentText && attachmentIsReal && claim.uses_attachment === true) {
        evidenceTexts.push(attachmentText);
      }

      const support = checkClaimSupport(claim.claim, evidenceTexts);
      // Registro sem o texto da pergunta nem da claim (dados de empresa,
      // LGPD): só ids das fontes citadas e os tokens sinalizados.
      const citedIds = [
        ...claim.chunk_ids,
        ...claim.operational_ref_ids,
        ...claim.company_chunk_ids,
        ...claim.checklist_ref_ids,
      ];
      // Regra de privacidade do trace: os tokens só são guardados quando a claim cita
      // EXCLUSIVAMENTE trechos normativos oficiais (ver tokensAllowedForClaim).
      const tokensAllowed = tokensAllowedForClaim({
        chunk_ids: claim.chunk_ids,
        operational_ref_ids: claim.operational_ref_ids,
        company_chunk_ids: claim.company_chunk_ids,
        checklist_ref_ids: claim.checklist_ref_ids,
        uses_attachment: attachmentIsReal && claim.uses_attachment === true,
      });
      if (support.logged.length > 0) {
        if (tokensAllowed) traceState.flaggedNumbers.push(...support.logged);
        this.logger.warn(
          `Número com unidade sem base nas fontes citadas (só registrado): ${support.logged.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
      }
      if (support.blocking.length > 0) {
        traceState.claimsDroppedSupport += 1;
        if (tokensAllowed) traceState.blockingTokens.push(...support.blocking);
        this.logger.warn(
          `Claim descartada — item/NR sem base nas fontes citadas: ${support.blocking.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
        return false;
      }
      traceState.keptClaims.push({ chunk_ids: claim.chunk_ids });
      return true;
    });

    if (survivingClaims.length === 0) {
      return finish(
        {
          answer: null,
          message: FALLBACK_MESSAGE,
          citations: [],
          company_citations: [],
          checklist_citations: [],
          notices,
          attachment_warning: attachmentWarning,
        },
        'fallback_claims_descartadas',
      );
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

    // Agrupado por item_id — cada item do checklist JÁ é a unidade de
    // citação (ao contrário dos chunks, que agrupam por document_id).
    const usedChecklistIds = new Set(survivingClaims.flatMap((c) => c.checklist_ref_ids));
    const checklistCitationsById = new Map<string, ChecklistItemCitation>();
    for (const item of relevantChecklist) {
      if (usedChecklistIds.has(item.item_id)) {
        checklistCitationsById.set(item.item_id, {
          item_id: item.item_id,
          nr_code: item.nr_code,
          document_name: item.document_name,
        });
      }
    }

    const usedAttachment = attachmentIsReal && survivingClaims.some((c) => c.uses_attachment);

    const result: NormativeQueryResult = {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
      company_citations: Array.from(companyCitationsByDocument.values()),
      checklist_citations: Array.from(checklistCitationsById.values()),
      notices,
      used_attachment: usedAttachment ? true : undefined,
      attachment_warning: attachmentWarning,
    };
    return finish(result, 'respondeu');
  }

  private ragThreshold(): number {
    return envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.4);
  }

  // Busca de referência (sem tenant e sem LLM): normas oficiais vigentes e checklist
  // interno. Extraída de queryWithTrace para que o runner de avaliação (Camada A) e a
  // pergunta real usem EXATAMENTE a mesma busca — sem cópia que possa divergir.
  private async searchReference(questionEmbedding: number[], chunkLimit: number): Promise<ReferenceSearch> {
    // `official_sources`, `normative_documents` e
    // `normative_document_chunks` não têm tenant_id nem RLS — não há
    // contexto de tenant a propagar aqui. Usar withoutTenantContext (só
    // pool.connect()/release(), sem BEGIN/COMMIT) garante que nenhuma
    // conexão do pool fica presa "idle in transaction" durante as
    // chamadas HTTP externas lentas (embed acima, answer abaixo) — ver
    // Finding C1a da revisão final da Fase 9.
    const { rows: normativeRows } = await this.db.withoutTenantContext((client) =>
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

    // Busca no checklist interno de documentação SST (Montese) — mesmo
    // padrão da busca em normative_document_chunks acima: sempre
    // executada (não depende de tenantId, é conhecimento geral, não
    // específico de uma empresa), mesma transação curta e separada
    // (withoutTenantContext), mesmo threshold/limit. `content` usa a
    // MESMA fórmula de 4 campos do texto embedado (ver Global
    // Constraints) — assim o texto que o modelo lê no prompt é
    // exatamente o texto que foi usado pra calcular a similaridade que
    // trouxe esse item pra cá, incluindo o requisito legal literal
    // (útil quando a pergunta cita um número de item de norma).
    const { rows: checklistRows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChecklistItem>(
        `SELECT id AS item_id, nr_code, document_name,
                nr_code || ' — ' || document_name || ': ' || description || ' — ' || legal_requirement AS content,
                1 - (embedding <=> $1::vector) AS similarity
         FROM sst_checklist_items
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );
    return { normativeRows, checklistRows };
  }
}
