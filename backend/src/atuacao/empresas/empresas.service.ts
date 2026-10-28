import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DocumentsService, type Document } from '../../documents/documents.service';
import { todayDateOnly } from '../../common/dates/date-only';
import { deriveAccessState } from '../../payments/subscription-access.service';
import type { VigenciaDto } from './dto/vigencia.dto';
import type { AuditCtx } from '../permissoes/permissoes-admin.service';

// Projeção pública do documento: nunca expõe file_key (chave do objeto no R2) nem ids internos de quem subiu.
function paraDocumentoPublico(d: Document) {
  return {
    id: d.id, category: d.category, title: d.title, file_name: d.file_name,
    valid_from: d.valid_from, expires_at: d.expires_at, situacao: d.situacao,
  };
}

// Cada método recebe o `client` já dentro do contexto do sócio (req.withTenantContext):
// a RLS (is_montese_tenant) esconde empresas que não são clientes Montese.
@Injectable()
export class EmpresasService {
  constructor(private readonly docs: DocumentsService) {}

  async exigirEmpresa(c: PoolClient, tenantId: string) {
    const r = await c.query(
      `SELECT t.id, t.name, t.trade_name, t.cnpj,
              EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'authorized') AS has_authorized,
              EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'pending'
                      AND s.created_at > now() - interval '3 days') AS has_recent_pending,
              EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status IN ('cancelled','paused')) AS has_lapsed
         FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return {
      id: row.id as string, name: row.name as string, trade_name: (row.trade_name ?? null) as string | null,
      cnpj: row.cnpj as string, situacao: deriveAccessState(row),
    };
  }

  async visaoGeral(c: PoolClient, tenantId: string, hoje = new Date()) {
    const empresa = await this.exigirEmpresa(c, tenantId);
    const base = todayDateOnly(hoje);
    const f = await c.query("SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1 AND status = 'ativo'", [tenantId]);
    const d = await c.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE expires_at < $2::date)::int AS vencidos,
              count(*) FILTER (WHERE expires_at >= $2::date AND expires_at <= $2::date + 30)::int AS a_vencer_30d
         FROM documents WHERE tenant_id = $1`,
      [tenantId, base],
    );
    const e = await c.query('SELECT count(*)::int AS n FROM tenant_epis WHERE tenant_id = $1', [tenantId]);
    return { empresa, funcionarios_ativos: f.rows[0].n, documentos: d.rows[0], epis_cadastrados: e.rows[0].n };
  }

  async documentos(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await this.docs.findAll(c, tenantId)).map(paraDocumentoPublico);
  }

  // Confere que o documento pertence à empresa da URL (a RLS já esconde o que o sócio não vê).
  private async exigirDocumento(c: PoolClient, tenantId: string, id: string): Promise<Document> {
    await this.exigirEmpresa(c, tenantId);
    let doc: Document;
    try {
      doc = await this.docs.findOne(c, id);
    } catch (e) {
      if (e instanceof NotFoundException) throw new NotFoundException('Documento não encontrado');
      throw e;
    }
    if (doc.tenant_id !== tenantId) throw new NotFoundException('Documento não encontrado');
    return doc;
  }

  async download(c: PoolClient, tenantId: string, id: string) {
    await this.exigirDocumento(c, tenantId, id);
    return this.docs.getDownloadUrl(c, id);
  }

  // A auditoria é gravada na MESMA transação do UPDATE (fail-closed): se o INSERT falhar, a alteração sofre ROLLBACK.
  // O detail leva só o id do documento e datas ANTIGA→NOVA dos campos que de fato mudaram (datas não são dado pessoal).
  async alterarVigencia(c: PoolClient, tenantId: string, id: string, userId: string, dto: VigenciaDto, ctx?: AuditCtx) {
    // Corpo vazio: nada a alterar. Recusa antes de qualquer consulta/UPDATE (e sem auditoria).
    if (dto.valid_from === undefined && dto.expires_at === undefined) {
      throw new BadRequestException('Informe valid_from e/ou expires_at');
    }
    // Trava a linha antes de ler o estado "antigo" (mesma transação do UPDATE): o old→new auditado é fiel.
    await c.query('SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    const antes = await this.exigirDocumento(c, tenantId, id);
    // isAdmin=true só contorna a regra "só quem subiu pode alterar"; a barreira real é a permissão
    // `empresas.documentos` (PermissionsGuard) + RLS (socio só vê Montese) + trigger do banco, que
    // só deixa o sócio mudar colunas de vigência.
    const doc = await this.docs.updateValidity(c, id, userId, true, { validFrom: dto.valid_from, expiresAt: dto.expires_at });
    if (ctx) {
      const fmt = (v: unknown) => (v == null || v === '' ? '—' : String(v));
      const mudancas: string[] = [];
      for (const campo of ['valid_from', 'expires_at'] as const) {
        const velho = fmt(antes[campo]);
        const novo = fmt(doc[campo]);
        if (velho !== novo) mudancas.push(`${campo}: ${velho}→${novo}`);
      }
      await c.query(
        `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
         VALUES ($1, $2, 'company.documents.changed', 'tenant', $3, $4, $5, 200, $6, $7)`,
        [userId, ctx.role, tenantId, ctx.method, ctx.path, ctx.ip ?? null,
          [`documento: ${id}`, ...mudancas].join('; ')],
      );
    }
    return paraDocumentoPublico(doc);
  }

  async vencimentos(c: PoolClient, tenantId: string, hoje = new Date()) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(
      `SELECT id, category, title, expires_at::text AS expires_at, (expires_at - $2::date)::int AS dias_para_vencer
         FROM documents WHERE tenant_id = $1 AND expires_at IS NOT NULL ORDER BY expires_at, title LIMIT 500`,
      [tenantId, todayDateOnly(hoje)],
    )).rows;
  }

  // Sem cpf e sem birth_date, de propósito (minimização de dados pessoais).
  async funcionarios(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(
      `SELECT e.id, e.full_name, p.name AS cargo, e.department, e.company_unit_id,
              e.admission_date::text AS admission_date, e.status
         FROM employees e LEFT JOIN positions p ON p.id = e.position_id
        WHERE e.tenant_id = $1 ORDER BY e.full_name LIMIT 500`,
      [tenantId],
    )).rows;
  }

  async epi(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(
      `SELECT t.id, i.code, i.equipment_group, i.description
         FROM tenant_epis t JOIN epi_catalog_items i ON i.id = t.epi_catalog_item_id
        WHERE t.tenant_id = $1 ORDER BY i.code, i.description`,
      [tenantId],
    )).rows;
  }
}
