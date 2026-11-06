import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { CriarEmpresaDto } from './dto/criar-empresa.dto';
import { buildSafeSetClause } from '../common/safe-update.util';
import { deriveAccessState, SubscriptionAccess } from '../payments/subscription-access.service';

export const ACTING_TOKEN_TTL_SECONDS = 1800;

export const CAMPOS_OPERACIONAIS = ['trade_name', 'sector', 'contact_name', 'contact_role', 'contact_phone', 'notes'] as const;

export interface Responsavel { id: string; full_name: string }

export interface ClienteResumo {
  id: string; name: string; trade_name: string | null; cnpj: string; sector: string | null;
  contact_name: string | null; contact_phone: string | null; status: string; situacao: SubscriptionAccess;
}
export interface ClienteFicha extends ClienteResumo {
  contact_role: string | null; notes: string | null; plan: string; created_at: string;
  responsaveis: Responsavel[];
  units: { id: string; name: string; address_city: string; address_state: string; status: string }[];
}

const SELECT_BASE = `
  SELECT t.id, t.name, t.trade_name, t.cnpj, t.sector, t.contact_name, t.contact_phone, t.status,
         t.contact_role, t.notes, t.plan, t.created_at,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'authorized') AS has_authorized,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'pending'
                 AND s.created_at > now() - interval '3 days') AS has_recent_pending,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status IN ('cancelled','paused')) AS has_lapsed
  FROM tenants t`;

function paraResumo(r: any): ClienteResumo {
  return {
    id: r.id, name: r.name, trade_name: r.trade_name ?? null, cnpj: r.cnpj, sector: r.sector ?? null,
    contact_name: r.contact_name ?? null, contact_phone: r.contact_phone ?? null, status: r.status,
    situacao: deriveAccessState(r),
  };
}

@Injectable()
export class AtuacaoService {
  async podeAtuar(client: PoolClient, socioId: string, tenantId: string): Promise<{ name: string } | null> {
    const ok = await client.query<{ ok: boolean }>('SELECT socio_can_act_on_tenant($1, $2) AS ok', [socioId, tenantId]);
    if (ok.rows[0]?.ok !== true) return null;
    const t = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId]);
    return t.rows[0] ? { name: t.rows[0].name } : null;
  }

  // Sem filtro de carteira no SQL: o RLS (tenants_socio_select + is_montese_tenant)
  // já restringe a empresas Montese, mesma convenção do resto do código.
  async listar(client: PoolClient, f: { q?: string; situacao?: SubscriptionAccess; meus?: boolean | string }, userId?: string): Promise<ClienteResumo[]> {
    const like = f.q ? `%${f.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const meus = (f.meus === true || f.meus === 'true') && !!userId;
    const params: any[] = [like];
    if (meus) params.push(userId);
    const res = await client.query(
      `${SELECT_BASE}
       WHERE ($1::text IS NULL OR t.name ILIKE $1 OR t.trade_name ILIKE $1 OR t.cnpj LIKE $1)
       ${meus ? 'AND EXISTS (SELECT 1 FROM tenant_owners o WHERE o.tenant_id = t.id AND o.user_id = $2)' : ''}
       ORDER BY t.name LIMIT 200`,
      params,
    );
    const todos = res.rows.map(paraResumo);
    return f.situacao ? todos.filter((c) => c.situacao === f.situacao) : todos;
  }

  async resumo(client: PoolClient) {
    const res = await client.query(`${SELECT_BASE} ORDER BY t.name`);
    const lista = res.rows.map(paraResumo);
    const n = (s: SubscriptionAccess) => lista.filter((c) => c.situacao === s).length;
    return { total: lista.length, ativos: n('ativa'), trial: n('trial'), pendentes: n('pendente'), inativos: n('inativa') };
  }

  async ficha(client: PoolClient, tenantId: string): Promise<ClienteFicha> {
    const res = await client.query(`${SELECT_BASE} WHERE t.id = $1`, [tenantId]);
    const r = res.rows[0];
    if (!r) throw new NotFoundException('Cliente não encontrado');
    const units = await client.query(
      'SELECT id, name, address_city, address_state, status FROM company_units WHERE tenant_id = $1 ORDER BY name',
      [tenantId],
    );
    const responsaveis = await this.responsaveisDe(client, tenantId);
    return { ...paraResumo(r), contact_role: r.contact_role ?? null, notes: r.notes ?? null, plan: r.plan, created_at: r.created_at, responsaveis, units: units.rows };
  }

  async atualizarOperacional(client: PoolClient, tenantId: string, data: Partial<Record<(typeof CAMPOS_OPERACIONAIS)[number], string>>): Promise<ClienteFicha> {
    const { setClauses, values } = buildSafeSetClause(data, CAMPOS_OPERACIONAIS, 2);
    if (setClauses.length > 0) {
      const upd = await client.query(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id`, [tenantId, ...values]);
      if (upd.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    }
    return this.ficha(client, tenantId);
  }

  private async responsaveisDe(client: PoolClient, tenantId: string): Promise<Responsavel[]> {
    const res = await client.query(
      `SELECT o.user_id AS id, s.full_name FROM tenant_owners o JOIN list_socios() s ON s.id = o.user_id
       WHERE o.tenant_id = $1 ORDER BY s.full_name`,
      [tenantId],
    );
    return res.rows.map((r: any) => ({ id: r.id, full_name: r.full_name }));
  }

  async equipe(client: PoolClient): Promise<Responsavel[]> {
    const res = await client.query('SELECT id, full_name FROM list_socios() ORDER BY full_name');
    return res.rows.map((r: any) => ({ id: r.id, full_name: r.full_name }));
  }

  // Substitui o conjunto de responsáveis. Roda no contexto admin (list_socios() só responde a socio/admin).
  async definirResponsaveis(client: PoolClient, tenantId: string, userIds: string[], adminId: string) {
    const t = await client.query('SELECT 1 FROM tenants WHERE id = $1 AND is_montese_tenant(id)', [tenantId]);
    if (t.rows.length === 0) throw new NotFoundException('Cliente não encontrado');
    if (userIds.length > 0) {
      const ok = await client.query('SELECT id FROM list_socios() WHERE id = ANY($1::uuid[])', [userIds]);
      if (ok.rows.length !== new Set(userIds).size) throw new BadRequestException('Responsável inválido');
    }
    await client.query('DELETE FROM tenant_owners WHERE tenant_id = $1', [tenantId]);
    if (userIds.length > 0) {
      await client.query(
        'INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) SELECT $1, u, $3 FROM unnest($2::uuid[]) AS u',
        [tenantId, userIds, adminId],
      );
    }
    return { tenant_id: tenantId, responsaveis: await this.responsaveisDe(client, tenantId) };
  }

  // O hash vem pronto do controller: este serviço nunca vê a senha em claro.
  async criarEmpresa(client: PoolClient, socioId: string, dto: CriarEmpresaDto, passwordHash: string): Promise<{ tenant_id: string; user_id: string }> {
    try {
      const res = await client.query<{ tenant_id: string; user_id: string }>(
        'SELECT * FROM socio_create_company($1, $2, $3, $4, $5, $6)',
        [socioId, dto.company_name, dto.cnpj, dto.email, passwordHash, dto.full_name],
      );
      return { tenant_id: res.rows[0].tenant_id, user_id: res.rows[0].user_id };
    } catch (err) {
      if ((err as { code?: string })?.code === '42501') {
        throw new ForbiddenException({ statusCode: 403, message: 'Você não tem permissão para esta ação.', code: 'PERMISSION_DENIED' });
      }
      return mapPgError(err); // mapPgError é `never`: o método sempre lança
    }
  }
}
