import { ForbiddenException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, TenantContext } from '../common/database/database.service';
import { normalizePositionText } from '../common/text/normalize-position-text.util';
import { PenteFinoExtractorService, ExtractedRow } from './pente-fino-extractor.service';
import { DocumentChecklistExtractorService } from './document-checklist-extractor.service';
import { LipAgentExtractorService, LipAgentRow, AgentCategory } from './lip-agent-extractor.service';
import { Document } from '../documents/documents.service';

export interface StoredRow {
  position_id: string | null;
  function_text_raw: string;
  description: string;
  source_excerpt: string;
}

export interface FunctionReportItem {
  position_id: string | null;
  position_name: string | null;
  function_text_raw: string;
  status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
  risks: { description: string; source_excerpt: string }[];
  exams: { description: string; source_excerpt: string }[];
}

const RUIDO_EXAM_KEYWORD = 'audiometr'; // cobre "audiometria", "audiométrico", "audiométrica"

export interface LipAgentFinding {
  agent_name_raw: string;
  agent_category: string;
  measured_value_raw: string | null;
  insalubre: boolean | null;
  conclusion_excerpt: string | null;
  exam_status: 'exame_ausente' | 'ok' | 'informativo';
}

// Função pura — sem I/O, testável isolada. Cruza só a categoria 'ruido'
// (spec §2: único par agente→exame citado sem ambiguidade na NR-07
// real) contra QUALQUER exam_description do PCMSO da empresa
// (granularidade por empresa inteira, não por função — spec §2).
//
// Usa normalizePositionText (já importado acima, mesma função que casa
// nome de função com cargo cadastrado) em vez de um toLowerCase() puro:
// "audiométrico"/"audiométrica" têm 'é' acentuado, que não é igual a
// 'e' só por causa da minúscula — sem remover o acento (NFD), a busca
// por substring 'audiometr' nunca bateria com a forma acentuada, só com
// "audiometria" (sem acento na sílaba relevante).
export function buildLipAgentFindings(
  lipAgents: { agentNameRaw: string; agentCategory: string; measuredValueRaw: string | null; insalubre: boolean | null; conclusionExcerpt: string | null }[],
  pcmsoExamDescriptions: string[],
): LipAgentFinding[] {
  const hasAudiometria = pcmsoExamDescriptions.some((d) => normalizePositionText(d).includes(RUIDO_EXAM_KEYWORD));

  return lipAgents.map((agent) => {
    let exam_status: LipAgentFinding['exam_status'] = 'informativo';
    if (agent.agentCategory === 'ruido' && agent.insalubre === true) {
      exam_status = hasAudiometria ? 'ok' : 'exame_ausente';
    }
    return {
      agent_name_raw: agent.agentNameRaw,
      agent_category: agent.agentCategory,
      measured_value_raw: agent.measuredValueRaw,
      insalubre: agent.insalubre,
      conclusion_excerpt: agent.conclusionExcerpt,
      exam_status,
    };
  });
}

export interface PenteFinoDocumentRef {
  id: string;
  title: string;
  // Quando a extração deste documento foi gravada (MAX(created_at) das linhas
  // dele). NULL quando não há linha nenhuma — extração falhou, o documento não
  // tinha texto aproveitável, ou ela ainda não rodou. Só populado pra
  // PGR/PCMSO (função/risco/exame) — LTCAT/LIP não têm esse conceito,
  // ficam sempre null aqui.
  extracted_at: string | null;
  // Checklist preliminar (Fase 27) — populado pros 4 tipos de documento.
  elaboration_date: string | null;
  elaboration_date_source_excerpt: string | null;
  professional_name: string | null;
  professional_registro: string | null;
  professional_papel: string | null;
  professional_source_excerpt: string | null;
}

export interface PenteFinoReport {
  pgr_document: PenteFinoDocumentRef | null;
  pcmso_document: PenteFinoDocumentRef | null;
  ltcat_document: PenteFinoDocumentRef | null;
  lip_document: PenteFinoDocumentRef | null;
  functions: FunctionReportItem[];
  lip_agents: LipAgentFinding[];
  warnings: string[];
}

interface ExtractionResult {
  rows: StoredRow[];
  extractedAt: string | null;
}

// 'nome_sem_correspondencia' vem por último de propósito (spec §2, item 5):
// sem o cargo canônico confirmando os dois lados, não dá pra afirmar que é um
// achado real, então ele não pode competir por atenção com os dois achados que
// são. 'ok' fica acima dele porque é um resultado confirmado, ainda que sem
// ação pendente.
const STATUS_PRIORITY: Record<FunctionReportItem['status'], number> = {
  risco_sem_exame: 0,
  exame_sem_risco: 1,
  ok: 2,
  nome_sem_correspondencia: 3,
};

export function sortFunctionsByPriority(functions: FunctionReportItem[]): FunctionReportItem[] {
  // .sort() do V8 é estável, então funções de mesmo status mantêm a ordem de
  // agrupamento (PGR primeiro, depois PCMSO) em vez de embaralhar a cada run.
  return [...functions].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}

// Função pura — sem I/O, testável isolada (unit-spec cobre a lógica de
// agrupamento e status sem precisar de Postgres real). Agrupa por
// position_id quando presente (cargo cadastrado, Fase 23); cai pra
// texto normalizado quando nenhum dos dois documentos bateu com um
// cargo — nesse caso o status é sempre 'nome_sem_correspondencia',
// mesmo que a função tenha risco E exame, porque não há garantia de
// que "Ajudante" no PGR seja a mesma pessoa/função que "Ajudante" no
// PCMSO sem o cargo canônico confirmando.
export function buildFunctionReport(
  pgrRows: StoredRow[],
  pcmsoRows: StoredRow[],
  positions: { id: string; name: string }[],
): FunctionReportItem[] {
  const groups = new Map<
    string,
    { position_id: string | null; function_text_raw: string; risks: StoredRow[]; exams: StoredRow[] }
  >();

  const keyFor = (row: StoredRow) =>
    row.position_id ? `pos:${row.position_id}` : `text:${normalizePositionText(row.function_text_raw)}`;

  for (const row of pgrRows) {
    const key = keyFor(row);
    if (!groups.has(key)) {
      groups.set(key, { position_id: row.position_id, function_text_raw: row.function_text_raw, risks: [], exams: [] });
    }
    groups.get(key)!.risks.push(row);
  }
  for (const row of pcmsoRows) {
    const key = keyFor(row);
    if (!groups.has(key)) {
      groups.set(key, { position_id: row.position_id, function_text_raw: row.function_text_raw, risks: [], exams: [] });
    }
    groups.get(key)!.exams.push(row);
  }

  const positionNameById = new Map(positions.map((p) => [p.id, p.name]));

  return Array.from(groups.values()).map((g) => {
    let status: FunctionReportItem['status'];
    if (g.position_id === null) {
      status = 'nome_sem_correspondencia';
    } else if (g.risks.length > 0 && g.exams.length === 0) {
      status = 'risco_sem_exame';
    } else if (g.exams.length > 0 && g.risks.length === 0) {
      status = 'exame_sem_risco';
    } else {
      status = 'ok';
    }
    return {
      position_id: g.position_id,
      position_name: g.position_id ? (positionNameById.get(g.position_id) ?? null) : null,
      function_text_raw: g.function_text_raw,
      status,
      risks: g.risks.map((r) => ({ description: r.description, source_excerpt: r.source_excerpt })),
      exams: g.exams.map((e) => ({ description: e.description, source_excerpt: e.source_excerpt })),
    };
  });
}

// Coluna DATE do Postgres chega via node-pg como objeto Date (não
// string) quando lida do caminho de cache — diferente do caminho de
// extração nova, onde já é a string 'AAAA-MM-DD' validada por
// isValidIsoDate antes de persistir. Normaliza os dois casos pro mesmo
// formato de saída (mesmo padrão de toDateString em dashboard.service.ts).
function toDateStringOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

@Injectable()
export class PenteFinoComparisonService {
  constructor(
    private readonly extractor: PenteFinoExtractorService,
    private readonly checklistExtractor: DocumentChecklistExtractorService,
    private readonly lipAgentExtractor: LipAgentExtractorService,
    private readonly db: DatabaseService,
  ) {}

  // `tenantId` é o ALVO do cruzamento (qual empresa analisar) e só pode ser
  // usado como parâmetro de WHERE em SQL. O contexto de RLS sai SEMPRE do
  // usuário autenticado (`user`, montado a partir do JWT pelo JwtAuthGuard),
  // igual ao que o TenantContextInterceptor faz em todas as outras rotas.
  //
  // Isso não é estilo, é segurança: pra técnico/parceiro o `tenantId` alvo vem
  // do corpo da requisição. Se ele fosse pra `TenantContext.tenantId`, o
  // `SET LOCAL app.tenant_id` satisfaria sozinho o ramo
  // `tenant_id = current_setting('app.tenant_id')` de TODA policy de RLS do
  // projeto, e qualquer técnico autenticado leria a empresa de quem quisesse
  // só sabendo o UUID dela. Com o tenant_id do JWT (NULL pra
  // técnico/parceiro), `app.tenant_id` fica vazio e a RLS cai no ramo
  // `assigned_tenant_ids_for_current_user()`, que é a checagem de vínculo de
  // verdade.
  async run(
    tenantId: string,
    user: { id: string; tenantId: string | null; role: string },
  ): Promise<PenteFinoReport> {
    const ctx: TenantContext = { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role };

    // A RLS sozinha já devolveria relatório vazio pra um técnico não
    // vinculado; esta checagem existe pra ele receber um 403 explícito em vez
    // de um "nenhum documento encontrado" ambíguo (mesma função SQL que as
    // policies usam, então não há regra de autorização duplicada aqui).
    if (user.role !== 'empresa') {
      const linked = await this.db.withTenantContext(ctx, (client) =>
        client.query<{ linked: boolean }>(
          `SELECT $1::uuid IN (SELECT assigned_tenant_ids_for_current_user()) AS linked`,
          [tenantId],
        ),
      );
      if (!linked.rows[0]?.linked) {
        throw new ForbiddenException('Você não está vinculado a esta empresa');
      }
    }

    const { pgr, pcmso, ltcat, lip, positions } = await this.db.withTenantContext(ctx, (client) =>
      this.loadContext(client, tenantId),
    );

    const warnings: string[] = [];
    if (!pgr) warnings.push('Nenhum PGR encontrado — cruzamento de risco fica limitado até um PGR ser enviado.');
    if (!pcmso) warnings.push('Nenhum PCMSO encontrado — cruzamento de exame fica limitado até um PCMSO ser enviado.');
    // LTCAT/LIP não geram warning: ausência é frequentemente legítima
    // (só empresas com exposição a agentes insalubres/periculosos
    // precisam desses dois documentos) — decisão da spec §2.

    const pgrExtraction = pgr ? await this.ensureExtracted(ctx, pgr, 'risco', positions) : null;
    const pcmsoExtraction = pcmso ? await this.ensureExtracted(ctx, pcmso, 'exame', positions) : null;

    const [pgrRef, pcmsoRef, ltcatRef, lipRef] = await Promise.all([
      this.buildDocumentRef(ctx, pgr),
      this.buildDocumentRef(ctx, pcmso),
      this.buildDocumentRef(ctx, ltcat),
      this.buildDocumentRef(ctx, lip),
    ]);

    const lipAgentRows = await this.ensureLipAgents(ctx, lip);
    const pcmsoExamDescriptions = pcmsoExtraction?.rows.map((r) => r.description) ?? [];
    const lipAgentFindings = buildLipAgentFindings(lipAgentRows, pcmsoExamDescriptions);

    return {
      pgr_document: pgrRef ? { ...pgrRef, extracted_at: pgrExtraction?.extractedAt ?? null } : null,
      pcmso_document: pcmsoRef ? { ...pcmsoRef, extracted_at: pcmsoExtraction?.extractedAt ?? null } : null,
      ltcat_document: ltcatRef,
      lip_document: lipRef,
      functions: sortFunctionsByPriority(
        buildFunctionReport(pgrExtraction?.rows ?? [], pcmsoExtraction?.rows ?? [], positions),
      ),
      lip_agents: lipAgentFindings,
      warnings,
    };
  }

  private async loadContext(
    client: PoolClient,
    tenantId: string,
  ): Promise<{
    pgr: Document | null;
    pcmso: Document | null;
    ltcat: Document | null;
    lip: Document | null;
    positions: { id: string; name: string }[];
  }> {
    const pgrResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'pgr' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const pcmsoResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'pcmso' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const ltcatResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'ltcat' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const lipResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'lip' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const positionsResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM positions WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      pgr: pgrResult.rows[0] ?? null,
      pcmso: pcmsoResult.rows[0] ?? null,
      ltcat: ltcatResult.rows[0] ?? null,
      lip: lipResult.rows[0] ?? null,
      positions: positionsResult.rows,
    };
  }

  // Reaproveita extração já feita pro mesmo document_id (spec §2: "sob
  // demanda... reaproveita se o documento não mudou"); só chama a IA
  // de novo se ainda não houver nenhuma linha persistida pra este
  // document_id. Limitação aceita (registrada na spec, fora de escopo
  // resolver aqui): um documento cuja extração legitimamente não
  // encontra função nenhuma (ex.: PDF escaneado sem texto) é
  // reprocessado a cada chamada, já que "zero linhas" é indistinguível
  // de "nunca extraído" — impacto baixo (o teto de tempo/custo já
  // existe na própria extração, e esse caso é raro na prática).
  private async ensureExtracted(
    ctx: TenantContext,
    document: Document,
    kind: 'risco' | 'exame',
    positions: { id: string; name: string }[],
  ): Promise<ExtractionResult> {
    const table = kind === 'risco' ? 'pgr_function_risks' : 'pcmso_function_exams';
    const descriptionColumn = kind === 'risco' ? 'risk_description' : 'exam_description';

    const existing = await this.db.withTenantContext(ctx, (client) =>
      client.query<StoredRow & { created_at: Date }>(
        `SELECT position_id, function_text_raw, ${descriptionColumn} AS description, source_excerpt, created_at
         FROM ${table} WHERE document_id = $1`,
        [document.id],
      ),
    );
    // Re-deriva o position_id contra a lista de cargos ATUAL em vez de
    // confiar no que está gravado: o valor persistido foi resolvido uma única
    // vez, na primeira extração. Sem isto, cadastrar o cargo que faltava —
    // exatamente a ação que o status 'nome_sem_correspondencia' pede — e
    // rodar o Pente-Fino de novo devolveria o mesmo relatório velho, porque o
    // caminho de cache nunca reavaliaria o casamento.
    if (existing.rows.length > 0) {
      return {
        rows: existing.rows.map((row) => ({
          position_id: this.extractor.matchPosition(row.function_text_raw, positions),
          function_text_raw: row.function_text_raw,
          description: row.description,
          source_excerpt: row.source_excerpt,
        })),
        extractedAt: maxCreatedAt(existing.rows),
      };
    }

    const extracted: ExtractedRow[] = await this.extractor.extractRows(document, kind, positions);
    // O MAX(created_at) sai da mesma transação que acabou de gravar as linhas
    // (índice por document_id, criado na migration 0042). Fica NULL quando a
    // extração legitimamente não produziu linha nenhuma — que é exatamente o
    // que 'extracted_at: null' comunica no relatório.
    const extractedAt = await this.db.withTenantContext(ctx, async (client) => {
      await this.extractor.persistRows(client, document, kind, extracted);
      const result = await client.query<{ extracted_at: Date | null }>(
        `SELECT MAX(created_at) AS extracted_at FROM ${table} WHERE document_id = $1`,
        [document.id],
      );
      return toIsoOrNull(result.rows[0]?.extracted_at);
    });

    return {
      rows: extracted.map((row) => ({
        position_id: row.positionId,
        function_text_raw: row.functionTextRaw,
        description: row.description,
        source_excerpt: row.sourceExcerpt,
      })),
      extractedAt,
    };
  }

  // Checklist preliminar (Fase 27) — roda pros 4 tipos de documento.
  // Cache-first, mesmo padrão de ensureExtracted: uma linha já
  // persistida em document_checklist_findings pro mesmo document_id
  // significa "já rodou" (mesmo que todos os 6 campos estejam null —
  // diferente de pgr_function_risks/pcmso_function_exams, aqui SEMPRE
  // há uma linha após a primeira execução bem-sucedida, então não há
  // a ambiguidade "zero linhas = nunca rodou ou rodou e não achou
  // nada" que aquelas duas tabelas aceitam).
  private async buildDocumentRef(
    ctx: TenantContext,
    document: Document | null,
  ): Promise<PenteFinoDocumentRef | null> {
    if (!document) return null;

    const existing = await this.db.withTenantContext(ctx, (client) =>
      client.query<{
        elaboration_date: string | Date | null;
        elaboration_date_source_excerpt: string | null;
        professional_name: string | null;
        professional_registro: string | null;
        professional_papel: string | null;
        professional_source_excerpt: string | null;
      }>(
        `SELECT elaboration_date, elaboration_date_source_excerpt, professional_name,
                professional_registro, professional_papel, professional_source_excerpt
         FROM document_checklist_findings WHERE document_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [document.id],
      ),
    );

    let checklist: {
      elaboration_date: string | Date | null;
      elaboration_date_source_excerpt: string | null;
      professional_name: string | null;
      professional_registro: string | null;
      professional_papel: string | null;
      professional_source_excerpt: string | null;
    };
    if (existing.rows[0]) {
      checklist = existing.rows[0];
    } else {
      const row = await this.checklistExtractor.extractChecklist(document);
      await this.db.withTenantContext(ctx, (client) => this.checklistExtractor.persist(client, document, row));
      checklist = {
        elaboration_date: row.elaborationDate,
        elaboration_date_source_excerpt: row.elaborationDateSourceExcerpt,
        professional_name: row.professionalName,
        professional_registro: row.professionalRegistro,
        professional_papel: row.professionalPapel,
        professional_source_excerpt: row.professionalSourceExcerpt,
      };
    }

    return {
      id: document.id,
      title: document.title,
      extracted_at: null,
      elaboration_date: toDateStringOrNull(checklist.elaboration_date),
      elaboration_date_source_excerpt: checklist.elaboration_date_source_excerpt,
      professional_name: checklist.professional_name,
      professional_registro: checklist.professional_registro,
      professional_papel: checklist.professional_papel,
      professional_source_excerpt: checklist.professional_source_excerpt,
    };
  }

  // Checklist de agentes do LIP (Fase 28). Cache-first, mesmo padrão de
  // ensureExtracted — zero linhas em lip_agent_findings é ambíguo entre
  // "nunca rodou" e "rodou e não achou agente nenhum", mesma limitação
  // aceita em pgr_function_risks/pcmso_function_exams (diferente de
  // document_checklist_findings, que sempre tem exatamente 1 linha).
  private async ensureLipAgents(ctx: TenantContext, document: Document | null): Promise<LipAgentRow[]> {
    if (!document) return [];
    const existing = await this.db.withTenantContext(ctx, (client) =>
      client.query<{
        agent_name_raw: string;
        agent_category: string;
        measured_value_raw: string | null;
        insalubre: boolean | null;
        conclusion_excerpt: string | null;
      }>(
        `SELECT agent_name_raw, agent_category, measured_value_raw, insalubre, conclusion_excerpt
         FROM lip_agent_findings WHERE document_id = $1`,
        [document.id],
      ),
    );
    if (existing.rows.length > 0) {
      return existing.rows.map((r) => ({
        agentNameRaw: r.agent_name_raw,
        agentCategory: r.agent_category as AgentCategory,
        measuredValueRaw: r.measured_value_raw,
        insalubre: r.insalubre,
        conclusionExcerpt: r.conclusion_excerpt,
        sourceExcerpt: '', // não usado no relatório, só necessário no formato de LipAgentRow
      }));
    }
    const rows = await this.lipAgentExtractor.extractAgents(document);
    await this.db.withTenantContext(ctx, (client) => this.lipAgentExtractor.persist(client, document, rows));
    return rows;
  }
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function maxCreatedAt(rows: { created_at: Date | string }[]): string | null {
  let max: number | null = null;
  for (const row of rows) {
    const time = new Date(row.created_at).getTime();
    // created_at é NOT NULL no schema, mas uma data inválida aqui viraria um
    // RangeError no toISOString() e derrubaria o relatório inteiro por causa
    // de um campo informativo — não vale o risco.
    if (Number.isNaN(time)) continue;
    if (max === null || time > max) max = time;
  }
  return max === null ? null : new Date(max).toISOString();
}
