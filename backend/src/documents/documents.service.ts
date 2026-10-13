import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { R2Service } from '../common/r2/r2.service';
import { mapPgError } from '../common/pg-error.util';
import { DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { verifyFileContent } from '../common/files/file-content.util';
import { documentSituation, todayDateOnly, toDateOnly, type DateOnly, type DocumentSituation } from '../common/dates/date-only';
import { mergeValidityPatch, resolveValidity, toBadRequest, type ExpiresSource } from './document-validity';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', DOCX_MIME_TYPE, XLSX_MIME_TYPE];
const ALLOWED_CATEGORIES = [
  'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
  'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
  'ltcat', 'lip',
  'relatorio_visita',
];

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Forma "enriquecida" do documento — usada no upload (após o INSERT) e na
// listagem. As colunas DATE vêm do pg como Date ou texto dependendo do
// driver/caminho; o service SEMPRE devolve as datas como 'AAAA-MM-DD' (ou
// null) para evitar deslocamentos de fuso na resposta JSON.
export interface Document {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  valid_from: DateOnly | null;
  expires_at: DateOnly | null;
  expires_source: ExpiresSource | null;
  validity_months_applied: number | null;
  situacao: DocumentSituation;
  uploaded_by_user_id: string;
  uploaded_by_role: string;
  company_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

export interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}

export interface PortfolioComplianceItem {
  tenant_id: string;
  tenant_name: string;
  score: number | null;
  empresa_destaque: boolean;
  pendencias_count: number;
  avisos_count: number;
}

export interface DocumentValidityRule {
  category: string;
  validity_months: number | null;
  alert_days: number;
  updated_at?: string;
  updated_by_user_id?: string | null;
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface UploadData {
  tenantId: string;
  category: string;
  title: string;
  validFrom?: string | null;
  expiresAt?: string | null;
  file: UploadFile;
  uploadedByUserId: string;
  uploadedByRole: 'empresa' | 'tecnico' | 'parceiro';
  companyUnitId?: string;
}

// Linha crua do pg após RETURNING — datas já vêm como string 'AAAA-MM-DD'
// graças ao ::text no SELECT (evita o bug de fuso já visto no projeto).
interface DocumentRow {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  valid_from: string | null;
  expires_at: string | null;
  expires_source: string | null;
  validity_months_applied: number | null;
  uploaded_by_user_id: string;
  uploaded_by_role: string;
  company_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DocumentListRow extends DocumentRow {
  alert_days: number | null;
}

// União para aceitar tanto a forma "crua" do RETURNING (sem alert_days)
// quanto a forma "listada" (com LEFT JOIN). `alert_days` é opcional aqui
// porque a função SEMPRE recebe o alertDays pelo segundo argumento.
type DocumentSource = DocumentRow | (DocumentRow & { alert_days?: number | null });

const DEFAULT_ALERT_DAYS = 30;

@Injectable()
export class DocumentsService {
  constructor(private readonly r2: R2Service) {}

  // Tabela global de regras. Como a table é GLOBAL (sem tenant_id) e o RLS
  // não atua, a query dentro do contexto de tenant funciona normalmente —
  // toda linha é visível para qualquer usuário autenticado.
  private async loadRule(client: PoolClient, category: string): Promise<DocumentValidityRule | null> {
    const result = await client.query<DocumentValidityRule>(
      'SELECT category, validity_months, alert_days FROM document_validity_rules WHERE category = $1',
      [category],
    );
    return result.rows[0] ?? null;
  }

  async upload(client: PoolClient, data: UploadData): Promise<Document> {
    if (!ALLOWED_MIME_TYPES.includes(data.file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só PDF, JPG, PNG, DOCX ou XLSX)');
    }
    // ITEM 004: o Content-Type acima é declarado pelo cliente; aqui o
    // conteúdo real é conferido contra ele, antes de qualquer toque no R2.
    const contentProblem = await verifyFileContent(data.file.buffer, data.file.mimetype);
    if (contentProblem) throw new BadRequestException(contentProblem);
    if (!ALLOWED_CATEGORIES.includes(data.category)) {
      throw new BadRequestException('Categoria inválida');
    }
    if (data.companyUnitId) {
      // FK só garante que o id existe em algum tenant — sem isso, dava
      // pra rotular um documento com a unidade de OUTRA empresa (o
      // documento em si continua isolado por tenant_id/RLS normalmente,
      // mas o rótulo ficaria errado).
      const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
        data.companyUnitId,
        data.tenantId,
      ]);
      if (unitCheck.rowCount === 0) {
        throw new BadRequestException('Filial/matriz inválida para esta empresa');
      }
    }

    // resolveValidity é pura e pode lançar Error de validação de data ou de
    // ordem (expires_at < valid_from). Converte em 400 aqui — antes era um
    // Error genérico que virava 500.
    const rule = await this.loadRule(client, data.category);
    let resolved;
    try {
      resolved = resolveValidity({
        validFrom: data.validFrom ?? null,
        expiresAt: data.expiresAt ?? null,
        ruleMonths: rule?.validity_months ?? null,
      });
    } catch (err) {
      throw toBadRequest(err);
    }

    const id = randomUUID();
    const fileKey = `tenants/${data.tenantId}/documents/${id}/${sanitizeFileName(data.file.originalname)}`;
    await this.r2.putObject(fileKey, data.file.buffer, data.file.mimetype);

    try {
      // ::text garante que a coluna DATE chega como 'AAAA-MM-DD' tanto no
      // RETURNING quanto no upload, sem depender de fuso do driver.
      const result = await client.query<DocumentRow>(
        `INSERT INTO documents (id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes,
                                valid_from, expires_at, expires_source, validity_months_applied,
                                uploaded_by_user_id, uploaded_by_role, company_unit_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes,
                   valid_from::text AS valid_from, expires_at::text AS expires_at,
                   expires_source, validity_months_applied,
                   uploaded_by_user_id, uploaded_by_role, company_unit_id, created_at, updated_at`,
        [
          id,
          data.tenantId,
          data.category,
          data.title,
          fileKey,
          data.file.originalname,
          data.file.mimetype,
          data.file.size,
          resolved.validFrom,
          resolved.expiresAt,
          resolved.expiresSource,
          resolved.validityMonthsApplied,
          data.uploadedByUserId,
          data.uploadedByRole,
          data.companyUnitId ?? null,
        ],
      );
      return this.toDocument(result.rows[0], rule?.alert_days ?? DEFAULT_ALERT_DAYS);
    } catch (err) {
      // O objeto já foi gravado no R2 real antes do INSERT — se o INSERT
      // falhar (ex: RLS rejeitando um técnico não vinculado ao tenant), sem
      // isso o objeto ficaria órfão no bucket pra sempre.
      try {
        await this.r2.deleteObject(fileKey);
      } catch {
        // Best-effort: não deixa uma falha na limpeza mascarar o erro
        // real do INSERT, que é o que o caller precisa ver.
      }
      mapPgError(err);
    }
  }

  // Converte a linha crua do pg (Date/string) para o formato de resposta
  // estável: datas como 'AAAA-MM-DD' (nunca Date), situacao calculada.
  // `alertDaysForCategory` é lido da regra (LEFT JOIN) ou DEFAULT_ALERT_DAYS.
  private toDocument(row: DocumentSource, alertDaysForCategory: number): Document {
    const validFrom = toDateOnly(row.valid_from);
    const expiresAt = toDateOnly(row.expires_at);
    const today = todayDateOnly(new Date());
    const situacao = documentSituation(expiresAt, today, alertDaysForCategory);
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      category: row.category,
      title: row.title,
      file_key: row.file_key,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      valid_from: validFrom,
      expires_at: expiresAt,
      expires_source: (row.expires_source as ExpiresSource | null) ?? null,
      validity_months_applied: row.validity_months_applied ?? null,
      situacao,
      uploaded_by_user_id: row.uploaded_by_user_id,
      uploaded_by_role: row.uploaded_by_role,
      company_unit_id: row.company_unit_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Document[]> {
    // ::text garante que a coluna DATE chega como string 'AAAA-MM-DD' —
    // sem isso, o driver pg devolve Date à meia-noite local, e dependendo
    // do fuso da máquina o dia pode "andar" (já aconteceu no projeto). As
    // demais colunas da regra são lidas direto do banco global.
    const result = await client.query<DocumentListRow>(
      `SELECT d.id, d.tenant_id, d.category, d.title, d.file_key, d.file_name, d.mime_type, d.size_bytes,
              d.valid_from::text AS valid_from,
              d.expires_at::text AS expires_at,
              d.expires_source, d.validity_months_applied,
              d.uploaded_by_user_id, d.uploaded_by_role, d.company_unit_id, d.created_at, d.updated_at,
              r.alert_days
       FROM documents d
       LEFT JOIN document_validity_rules r ON r.category = d.category
       ${tenantId ? 'WHERE d.tenant_id = $1' : ''}
       ORDER BY d.created_at DESC`,
      tenantId ? [tenantId] : [],
    );
    return result.rows.map((row) => this.toDocument(row, row.alert_days ?? DEFAULT_ALERT_DAYS));
  }

  async getCompliance(client: PoolClient, tenantId?: string): Promise<ComplianceResult> {
    const rows = tenantId
      ? (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL AND tenant_id = $1
             ORDER BY expires_at ASC`,
            [tenantId],
          )
        ).rows
      : (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL
             ORDER BY expires_at ASC`,
          )
        ).rows;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendencias: ComplianceItem[] = [];
    const avisos: ComplianceItem[] = [];
    let emDiaCount = 0;

    for (const row of rows) {
      const expiresAt = new Date(row.expires_at);
      expiresAt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        pendencias.push({ ...row, dias_vencido: -diffDays });
      } else if (diffDays <= 30) {
        avisos.push({ ...row, dias_restantes: diffDays });
        emDiaCount++;
      } else {
        emDiaCount++;
      }
    }

    const score = rows.length === 0 ? null : Math.round((emDiaCount / rows.length) * 100);
    return { score, pendencias, avisos };
  }

  async getPortfolioCompliance(
    client: PoolClient,
    userId: string,
    role: 'tecnico' | 'parceiro',
  ): Promise<PortfolioComplianceItem[]> {
    const linkTable = role === 'tecnico' ? 'tenant_technicians' : 'tenant_partners';
    const linkColumn = role === 'tecnico' ? 'technician_id' : 'partner_id';
    const personTable = role === 'tecnico' ? 'technicians' : 'partners';

    const result = await client.query<{
      tenant_id: string;
      tenant_name: string;
      document_id: string | null;
      expires_at: string | null;
    }>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, d.id AS document_id, d.expires_at
       FROM ${linkTable} lt
       JOIN ${personTable} p ON p.id = lt.${linkColumn}
       JOIN tenants t ON t.id = lt.tenant_id
       LEFT JOIN documents d ON d.tenant_id = t.id AND d.expires_at IS NOT NULL
       WHERE p.user_id = $1
       ORDER BY t.name`,
      [userId],
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const order: string[] = [];
    const groups = new Map<
      string,
      { tenant_name: string; total: number; emDia: number; pendencias: number; avisos: number }
    >();

    for (const row of result.rows) {
      if (!groups.has(row.tenant_id)) {
        groups.set(row.tenant_id, { tenant_name: row.tenant_name, total: 0, emDia: 0, pendencias: 0, avisos: 0 });
        order.push(row.tenant_id);
      }
      if (!row.expires_at) continue;

      const group = groups.get(row.tenant_id)!;
      group.total++;
      const expiresAt = new Date(row.expires_at);
      expiresAt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        group.pendencias++;
      } else if (diffDays <= 30) {
        group.avisos++;
        group.emDia++;
      } else {
        group.emDia++;
      }
    }

    return order.map((tenantId) => {
      const g = groups.get(tenantId)!;
      const score = g.total === 0 ? null : Math.round((g.emDia / g.total) * 100);
      return {
        tenant_id: tenantId,
        tenant_name: g.tenant_name,
        score,
        // Fase 16, revisão final: mesmo raciocínio de
        // DashboardService.getSummary — score === 100 sozinho não
        // bastava (arredondamento + avisos contados como emDia).
        empresa_destaque: score === 100 && g.pendencias === 0 && g.avisos === 0,
        pendencias_count: g.pendencias,
        avisos_count: g.avisos,
      };
    });
  }

  async findOne(client: PoolClient, id: string): Promise<Document> {
    // Mesma rota de listagem: LEFT JOIN para devolver o item já com
    // situacao/expires_at no formato canônico, em vez de reimplementar
    // a serialização.
    const result = await client.query<DocumentListRow>(
      `SELECT d.id, d.tenant_id, d.category, d.title, d.file_key, d.file_name, d.mime_type, d.size_bytes,
              d.valid_from::text AS valid_from,
              d.expires_at::text AS expires_at,
              d.expires_source, d.validity_months_applied,
              d.uploaded_by_user_id, d.uploaded_by_role, d.company_unit_id, d.created_at, d.updated_at,
              r.alert_days
       FROM documents d
       LEFT JOIN document_validity_rules r ON r.category = d.category
       WHERE d.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Documento não encontrado');
    return this.toDocument(row, row.alert_days ?? DEFAULT_ALERT_DAYS);
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  // Variante do findOne que trava a linha (`SELECT ... FOR UPDATE`) dentro
  // da MESMA transação/contexto de tenant já aberto. Usada exclusivamente
  // pelas rotas de MUTAÇÃO (PATCH /documents/:id/validity) para impedir que
  // dois PATCHs concorrentes leiam o mesmo estado e o último UPDATE ganhe
  // sem ver a mudança do outro. As rotas de LEITURA (GET e DOWNLOAD)
  // continuam usando findOne sem lock, preservando o comportamento delas.
  private async findOneForUpdate(client: PoolClient, id: string): Promise<Document> {
    const result = await client.query<DocumentListRow>(
      `SELECT d.id, d.tenant_id, d.category, d.title, d.file_key, d.file_name, d.mime_type, d.size_bytes,
              d.valid_from::text AS valid_from,
              d.expires_at::text AS expires_at,
              d.expires_source, d.validity_months_applied,
              d.uploaded_by_user_id, d.uploaded_by_role, d.company_unit_id, d.created_at, d.updated_at,
              r.alert_days
       FROM documents d
       LEFT JOIN document_validity_rules r ON r.category = d.category
       WHERE d.id = $1
       FOR UPDATE OF d`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Documento não encontrado');
    return this.toDocument(row, row.alert_days ?? DEFAULT_ALERT_DAYS);
  }

  async remove(client: PoolClient, id: string, userId: string, isAdmin: boolean): Promise<void> {
    // findOne aqui ainda roda dentro do withTenantContext — se a RLS já
    // escondeu o documento de outro tenant, a query devolve 0 linhas e o
    // 404 vem de findOne. Boa propriedade pra repetirmos no PATCH.
    const document = await this.findOne(client, id);
    if (!isAdmin && document.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('Só quem subiu o documento pode apagá-lo');
    }
    await this.r2.deleteObject(document.file_key);
    const result = await client.query('DELETE FROM documents WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Documento não encontrado');
  }

  // PATCH /api/documents/:id/validity. Mesma regra de autorização do DELETE
  // (uploader ou admin) e mesmo isolamento por tenant via RLS — se a linha
  // não pertence ao contexto, findOne lança 404 antes de qualquer UPDATE.
  //
  // Semântica de campos (controlada pela função pura mergeValidityPatch):
  //   - validFrom AUSENTE → mantém o atual; null → limpa; valor → grava.
  //   - expiresAt AUSENTE → recalcula pela regra SOMENTE se validFrom
  //     mudou nesta chamada; senão mantém o atual. Regra sem meses +
  //     validFrom novo → preserva (nunca zera).
  //   - expiresAt null → limpa; valor → grava, detecta se bate com a
  //     regra para virar 'rule' ou 'manual'.
  //   - valida expires_at >= valid_from no estado final.
  async updateValidity(
    client: PoolClient,
    id: string,
    userId: string,
    isAdmin: boolean,
    input: { validFrom?: string | null; expiresAt?: string | null },
  ): Promise<Document> {
    // findOneForUpdate trava a linha (SELECT ... FOR UPDATE) na MESMA
    // transação/contexto de tenant — sem isso, dois PATCHs simultâneos
    // sobre o mesmo documento leriam o mesmo estado e o último UPDATE
    // "venceria" sem preservar a alteração concorrente. As rotas de
    // leitura continuam usando findOne, então o lock é exclusivo desta
    // rota.
    const document = await this.findOneForUpdate(client, id);
    if (!isAdmin && document.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('Só quem subiu o documento pode alterar a vigência');
    }

    const rule = await this.loadRule(client, document.category);
    let resolved;
    try {
      resolved = mergeValidityPatch({
        validFrom: input.validFrom,
        expiresAt: input.expiresAt,
        currentValidFrom: document.valid_from,
        currentExpiresAt: document.expires_at,
        currentExpiresSource: document.expires_source,
        currentValidityMonthsApplied: document.validity_months_applied,
        ruleMonths: rule?.validity_months ?? null,
      });
    } catch (err) {
      throw toBadRequest(err);
    }

    try {
      const result = await client.query<DocumentRow>(
        `UPDATE documents
         SET valid_from = $2,
             expires_at = $3,
             expires_source = $4,
             validity_months_applied = $5,
             updated_at = now()
         WHERE id = $1
         RETURNING id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes,
                   valid_from::text AS valid_from, expires_at::text AS expires_at,
                   expires_source, validity_months_applied,
                   uploaded_by_user_id, uploaded_by_role, company_unit_id, created_at, updated_at`,
        [
          id,
          resolved.validFrom,
          resolved.expiresAt,
          resolved.expiresSource,
          resolved.validityMonthsApplied,
        ],
      );
      // Defesa contra deleção paralela entre findOneForUpdate e UPDATE: se
      // a linha sumiu nesse meio tempo, devolvemos 404 (não um documento
      // com dados parcialmente em cache).
      if (result.rows.length === 0) {
        throw new NotFoundException('Documento não encontrado');
      }
      return this.toDocument(result.rows[0], rule?.alert_days ?? DEFAULT_ALERT_DAYS);
    } catch (err) {
      // NOT NULL/CHECK/etc do Postgres viram 400 em vez de 500
      // (documents_validity_order_check, por exemplo). Exceções já
      // conhecidas (NotFoundException) seguem adiante porque não têm
      // `code` de erro do pg.
      mapPgError(err);
    }
  }

  // GET /api/documents/validity-rules — leitura das 12 categorias. A tabela
  // é GLOBAL e sem RLS (mesmo padrão de epi_catalog_items), então qualquer
  // usuário autenticado enxerga as 12 linhas.
  async findAllRules(client: PoolClient): Promise<DocumentValidityRule[]> {
    const result = await client.query<DocumentValidityRule>(
      `SELECT category, validity_months, alert_days
       FROM document_validity_rules
       ORDER BY category`,
    );
    return result.rows;
  }

  // PATCH /api/documents/validity-rules/:category — só admin. Categoria
  // inexistente → 404 (controller valida antes com NotFoundException, mas o
  // service também checa pra defesa em profundidade). Mudar a regra NÃO
  // recalcula documentos já salvos (princípio do briefing).
  //
  // Semântica de campos:
  //   - validityMonths AUSENTE → mantém o atual; null → grava NULL; valor
  //     → grava.
  //   - alertDays AUSENTE → mantém o atual.
  async updateRule(
    client: PoolClient,
    category: string,
    data: { validityMonths?: number | null; alertDays?: number | null },
    userId: string,
  ): Promise<DocumentValidityRule> {
    const existing = await this.loadRule(client, category);
    if (!existing) {
      throw new NotFoundException('Categoria de regra inexistente');
    }
    const validityMonths = data.validityMonths === undefined ? existing.validity_months : data.validityMonths;
    const alertDays = data.alertDays === undefined ? existing.alert_days : data.alertDays;
    const result = await client.query<DocumentValidityRule>(
      `UPDATE document_validity_rules
       SET validity_months = $2,
           alert_days = $3,
           updated_at = now(),
           updated_by_user_id = $4
       WHERE category = $1
       RETURNING category, validity_months, alert_days, updated_at, updated_by_user_id`,
      [category, validityMonths, alertDays, userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('Categoria de regra inexistente');
    }
    return result.rows[0];
  }
}