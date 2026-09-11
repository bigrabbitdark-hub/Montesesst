import { ForbiddenException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, TenantContext } from '../common/database/database.service';
import { normalizePositionText } from '../common/text/normalize-position-text.util';
import { PenteFinoExtractorService, ExtractedRow } from './pente-fino-extractor.service';
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

export interface PenteFinoReport {
  pgr_document: { id: string; title: string } | null;
  pcmso_document: { id: string; title: string } | null;
  functions: FunctionReportItem[];
  warnings: string[];
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

@Injectable()
export class PenteFinoComparisonService {
  constructor(
    private readonly extractor: PenteFinoExtractorService,
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

    const { pgr, pcmso, positions } = await this.db.withTenantContext(ctx, (client) =>
      this.loadContext(client, tenantId),
    );

    const warnings: string[] = [];
    if (!pgr) warnings.push('Nenhum PGR encontrado — cruzamento de risco fica limitado até um PGR ser enviado.');
    if (!pcmso) warnings.push('Nenhum PCMSO encontrado — cruzamento de exame fica limitado até um PCMSO ser enviado.');

    const pgrRows = pgr ? await this.ensureExtracted(ctx, pgr, 'risco', positions) : [];
    const pcmsoRows = pcmso ? await this.ensureExtracted(ctx, pcmso, 'exame', positions) : [];

    return {
      pgr_document: pgr ? { id: pgr.id, title: pgr.title } : null,
      pcmso_document: pcmso ? { id: pcmso.id, title: pcmso.title } : null,
      functions: buildFunctionReport(pgrRows, pcmsoRows, positions),
      warnings,
    };
  }

  private async loadContext(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ pgr: Document | null; pcmso: Document | null; positions: { id: string; name: string }[] }> {
    const pgrResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'pgr' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const pcmsoResult = await client.query<Document>(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'pcmso' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const positionsResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM positions WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      pgr: pgrResult.rows[0] ?? null,
      pcmso: pcmsoResult.rows[0] ?? null,
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
  ): Promise<StoredRow[]> {
    const table = kind === 'risco' ? 'pgr_function_risks' : 'pcmso_function_exams';
    const descriptionColumn = kind === 'risco' ? 'risk_description' : 'exam_description';

    const existing = await this.db.withTenantContext(ctx, (client) =>
      client.query<{ position_id: string | null; function_text_raw: string; description: string; source_excerpt: string }>(
        `SELECT position_id, function_text_raw, ${descriptionColumn} AS description, source_excerpt
         FROM ${table} WHERE document_id = $1`,
        [document.id],
      ),
    );
    if (existing.rows.length > 0) return existing.rows;

    const extracted: ExtractedRow[] = await this.extractor.extractRows(document, kind, positions);
    await this.db.withTenantContext(ctx, (client) => this.extractor.persistRows(client, document, kind, extracted));

    return extracted.map((row) => ({
      position_id: row.positionId,
      function_text_raw: row.functionTextRaw,
      description: row.description,
      source_excerpt: row.sourceExcerpt,
    }));
  }
}
