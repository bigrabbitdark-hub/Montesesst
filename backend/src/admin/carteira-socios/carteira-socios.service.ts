import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type AuditCtx = { role: string; method: string; path: string; ip?: string | null };
export const PAGE_SIZE = 100;

// Origem: 'explicita' = marcada em socio_portfolio (mesmo sem vínculos); 'automatica' = sem nenhuma linha em
// tenant_technicians/tenant_partners (qualquer status; mesma regra literal da 0091) e não marcada; 'fora' = tem vínculo e
// não foi marcada (não aparece para os sócios; é o que o admin pode incluir).
const ITEM_SQL = `
  SELECT t.id AS tenant_id, t.name AS nome, t.cnpj,
         (SELECT count(*)::int FROM tenant_technicians x WHERE x.tenant_id = t.id) AS tecnicos,
         (SELECT count(*)::int FROM tenant_partners x WHERE x.tenant_id = t.id) AS parceiros,
         (sp.tenant_id IS NOT NULL) AS marcada, sp.added_at, sp.note, u.full_name AS marcada_por_nome
    FROM tenants t
    LEFT JOIN socio_portfolio sp ON sp.tenant_id = t.id
    LEFT JOIN users u ON u.id = sp.added_by`;
const ORIGEM_SQL = `CASE WHEN marcada THEN 'explicita' WHEN tecnicos = 0 AND parceiros = 0 THEN 'automatica' ELSE 'fora' END`;

const origemDe = (r: any): 'explicita' | 'automatica' | 'fora' =>
  r.marcada ? 'explicita' : Number(r.tecnicos) === 0 && Number(r.parceiros) === 0 ? 'automatica' : 'fora';

function paraItem(r: any) {
  const origem: string = r.origem ?? origemDe(r);
  const item: any = {
    tenant_id: r.tenant_id as string,
    nome: r.nome as string,
    cnpj: r.cnpj as string,
    origem,
    vinculos: { tecnicos: Number(r.tecnicos), parceiros: Number(r.parceiros) },
  };
  if (origem === 'explicita') {
    item.marcada_por_nome = (r.marcada_por_nome as string | null) ?? null;
    item.marcada_em = r.added_at instanceof Date ? r.added_at.toISOString() : r.added_at;
    item.note = (r.note as string | null) ?? null;
  }
  return item;
}

// Carteira explícita dos sócios (somente admin). A auditoria é gravada na MESMA transação do chamador:
// se o INSERT falhar tudo sofre ROLLBACK. Ids apenas: nunca o texto da nota.
@Injectable()
export class CarteiraSociosService {
  async listar(client: PoolClient, f: { q?: string; origem?: string; page?: number }) {
    const page = f.page && f.page > 0 ? Math.floor(f.page) : 1;
    const q = (f.q ?? '').trim();
    const where: string[] = [];
    const params: any[] = [];
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      let cond = `(nome ILIKE $${params.length} ESCAPE '\\'`;
      const digitos = q.replace(/\D/g, '');
      if (digitos) {
        params.push(`%${digitos}%`);
        cond += ` OR cnpj LIKE $${params.length}`;
      }
      where.push(cond + ')');
    }
    if (f.origem && f.origem !== 'all') {
      params.push(f.origem);
      where.push(`origem = $${params.length}`);
    }
    const cte = `WITH base AS (SELECT s.*, ${ORIGEM_SQL} AS origem FROM (${ITEM_SQL}) s)`;
    const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await client.query(`${cte} SELECT count(*)::int AS total FROM base ${filtro}`, params)).rows[0].total as number;
    const res = await client.query(
      `${cte} SELECT * FROM base ${filtro} ORDER BY nome, tenant_id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    return { itens: res.rows.map(paraItem), total, page, page_size: PAGE_SIZE };
  }

  private async obter(client: PoolClient, tenantId: string) {
    const r = await client.query(`${ITEM_SQL} WHERE t.id = $1`, [tenantId]);
    return r.rows[0] ? paraItem(r.rows[0]) : null;
  }

  async marcar(client: PoolClient, adminId: string, tenantId: string, note: string | null | undefined, ctx?: AuditCtx) {
    // Serializa PUT/DELETE concorrentes da mesma empresa.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`socio_portfolio:${tenantId}`]);
    const atual = await this.obter(client, tenantId);
    if (!atual) throw new NotFoundException('Empresa não encontrada');
    if (atual.origem === 'automatica') throw new ConflictException('Esta empresa já faz parte da carteira automaticamente.');
    const notaInformada = note !== undefined;
    const nota = note === undefined || note === null || note === '' ? null : note;
    if (atual.origem === 'explicita' && !notaInformada) return atual;
    // Nota alterada por outro admin: added_by passa a ser quem editou (a RLS exige added_by = usuário atual).
    const ins = await client.query(
      `INSERT INTO socio_portfolio (tenant_id, added_by, note) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET note = EXCLUDED.note, added_by = EXCLUDED.added_by
       RETURNING (xmax = 0) AS inserido`,
      [tenantId, adminId, nota],
    );
    if (ins.rows[0]?.inserido && ctx) await this.auditar(client, adminId, 'carteira.added', tenantId, ctx);
    return (await this.obter(client, tenantId))!;
  }

  async desmarcar(client: PoolClient, adminId: string, tenantId: string, ctx?: AuditCtx) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`socio_portfolio:${tenantId}`]);
    const del = await client.query('DELETE FROM socio_portfolio WHERE tenant_id = $1', [tenantId]);
    if (!del.rowCount) throw new NotFoundException('Empresa não está marcada na carteira');
    if (ctx) await this.auditar(client, adminId, 'carteira.removed', tenantId, ctx);
    return (await this.obter(client, tenantId))!;
  }

  private auditar(client: PoolClient, adminId: string, action: string, tenantId: string, ctx: AuditCtx) {
    return client.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, 'tenant', $4, $5, $6, 200, $7, $8)`,
      [adminId, ctx.role, action, tenantId, ctx.method, ctx.path, ctx.ip ?? null, `empresa: ${tenantId}`],
    );
  }
}
