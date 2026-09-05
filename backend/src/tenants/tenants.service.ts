import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';

const ALLOWED_LOGO_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const UPDATABLE_FIELDS = [
  'sector',
  'contact_name',
  'contact_phone',
  'trade_name',
  'contact_role',
  'address_street',
  'address_number',
  'address_city',
  'address_state',
  'address_zip',
] as const;

// Campos que precisam estar TODOS presentes (endereço completo, mesma
// exigência de company_units) antes de criar/atualizar a unidade matriz
// automaticamente — ver comentário em `update()` abaixo.
const REQUIRED_MATRIZ_ADDRESS_FIELDS = ['address_street', 'address_city', 'address_state', 'address_zip'] as const;

export interface TenantLink {
  id: string;
  name: string;
}

export interface TenantWithLinks extends Tenant {
  technicians: TenantLink[];
  partners: TenantLink[];
}

export interface TenantDetailDocument {
  id: string;
  category: string;
  title: string;
  expires_at: string | null;
  created_at: string;
}

export interface TenantDetailEpi {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  category: string;
  code: string;
  description: string;
}

export interface TenantDetailInspection {
  id: string;
  status: string;
  visited_at: string;
  concluded_at: string | null;
}

export interface TenantDetailSubscription {
  id: string;
  status: string;
  created_at: string;
  plan_name: string;
  price_cents: number;
}

export interface TenantDetail {
  tenant: TenantWithLinks;
  documents: TenantDetailDocument[];
  epis: TenantDetailEpi[];
  inspections: TenantDetailInspection[];
  subscriptions: TenantDetailSubscription[];
}

export interface Tenant {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  trade_name: string | null;
  contact_role: string | null;
  address_street: string | null;
  address_number: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  logo_file_key: string | null;
  created_at: string;
  updated_at: string;
}

interface UpdateTenantData {
  sector?: string;
  contact_name?: string;
  contact_phone?: string;
  trade_name?: string;
  contact_role?: string;
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
}

// tenants NÃO tem RLS própria (ver Global Constraints do plano) — este
// service nunca aceita um id vindo de fora, só o tenantId já resolvido
// do JWT pelo controller (req.user.tenantId).
@Injectable()
export class TenantsService {
  constructor(private readonly r2: R2Service) {}

  async findAllWithLinks(client: PoolClient): Promise<TenantWithLinks[]> {
    const result = await client.query<TenantWithLinks>(
      `SELECT
         t.id, t.name, t.cnpj, t.plan, t.status, t.sector, t.contact_name,
         t.contact_phone, t.created_at, t.updated_at,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', tech.id, 'name', tu.full_name))
            FROM tenant_technicians tt
            JOIN technicians tech ON tech.id = tt.technician_id
            JOIN users tu ON tu.id = tech.user_id
            WHERE tt.tenant_id = t.id AND tt.status = 'ativo'),
           '[]'
         ) AS technicians,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', p.id, 'name', pu.full_name))
            FROM tenant_partners tp
            JOIN partners p ON p.id = tp.partner_id
            JOIN users pu ON pu.id = p.user_id
            WHERE tp.tenant_id = t.id AND tp.status = 'ativo'),
           '[]'
         ) AS partners
       FROM tenants t
       ORDER BY t.created_at DESC`,
    );
    return result.rows;
  }

  // Agrega tudo que hoje está espalhado entre /admin/empresas,
  // /admin/financeiro e as próprias telas de empresa/técnico/parceiro
  // numa única resposta pra uma empresa — mesmo estilo do /overview
  // (query direto contra as tabelas, sem injetar outros services): cada
  // tabela consultada já tem bypass de RLS pra admin desde a fase em que
  // foi criada.
  async findDetail(client: PoolClient, tenantId: string): Promise<TenantDetail> {
    const tenantResult = await client.query<TenantWithLinks>(
      `SELECT
         t.id, t.name, t.cnpj, t.plan, t.status, t.sector, t.contact_name,
         t.contact_phone, t.created_at, t.updated_at,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', tech.id, 'name', tu.full_name))
            FROM tenant_technicians tt
            JOIN technicians tech ON tech.id = tt.technician_id
            JOIN users tu ON tu.id = tech.user_id
            WHERE tt.tenant_id = t.id AND tt.status = 'ativo'),
           '[]'
         ) AS technicians,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', p.id, 'name', pu.full_name))
            FROM tenant_partners tp
            JOIN partners p ON p.id = tp.partner_id
            JOIN users pu ON pu.id = p.user_id
            WHERE tp.tenant_id = t.id AND tp.status = 'ativo'),
           '[]'
         ) AS partners
       FROM tenants t
       WHERE t.id = $1`,
      [tenantId],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');

    // Sequencial, não Promise.all: são 4 queries no mesmo PoolClient, que
    // processa uma consulta por vez — disparar em paralelo gera um warning
    // de depreciação do driver `pg` (removido em pg@9) sem ganhar nada,
    // já que a conexão é serializada de qualquer forma.
    const documents = await client.query<TenantDetailDocument>(
      `SELECT id, category, title, expires_at, created_at FROM documents
       WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    const epis = await client.query<TenantDetailEpi>(
      `SELECT te.id, te.ca_number, te.ca_valid_until, eci.category, eci.code, eci.description
       FROM tenant_epis te
       JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
       WHERE te.tenant_id = $1 ORDER BY te.created_at DESC`,
      [tenantId],
    );
    const inspections = await client.query<TenantDetailInspection>(
      `SELECT id, status, visited_at, concluded_at FROM inspections
       WHERE tenant_id = $1 ORDER BY visited_at DESC`,
      [tenantId],
    );
    const subscriptions = await client.query<TenantDetailSubscription>(
      `SELECT s.id, s.status, s.created_at, p.name AS plan_name, p.price_cents
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 ORDER BY s.created_at DESC`,
      [tenantId],
    );

    return {
      tenant,
      documents: documents.rows,
      epis: epis.rows,
      inspections: inspections.rows,
      subscriptions: subscriptions.rows,
    };
  }

  async findOne(client: PoolClient, id: string): Promise<Tenant> {
    const result = await client.query<Tenant>('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');
    return tenant;
  }

  async update(client: PoolClient, id: string, data: UpdateTenantData): Promise<Tenant> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Tenant>(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');

    // Assim que o endereço completo da matriz existir (pode levar mais de
    // uma chamada pra chegar nesse ponto, já que o formulário salva campo
    // por campo), cria/atualiza a company_unit marcada is_matriz — é o
    // que permite funcionário/documento se vincularem à matriz pelos
    // mesmos caminhos que já existem pra filial, sem código paralelo.
    const hasFullAddress = REQUIRED_MATRIZ_ADDRESS_FIELDS.every(
      (field) => tenant[field] !== null && tenant[field] !== '',
    );
    if (hasFullAddress) {
      await client.query(
        `INSERT INTO company_units (tenant_id, name, address_street, address_number, address_city, address_state, address_zip, is_matriz)
         VALUES ($1, 'Matriz', $2, $3, $4, $5, $6, true)
         ON CONFLICT (tenant_id) WHERE is_matriz = true
         DO UPDATE SET
           address_street = EXCLUDED.address_street,
           address_number = EXCLUDED.address_number,
           address_city = EXCLUDED.address_city,
           address_state = EXCLUDED.address_state,
           address_zip = EXCLUDED.address_zip`,
        [
          tenant.id,
          tenant.address_street,
          tenant.address_number,
          tenant.address_city,
          tenant.address_state,
          tenant.address_zip,
        ],
      );
    }

    return tenant;
  }

  async uploadLogo(
    client: PoolClient,
    tenantId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ has_logo: true }> {
    const ext = ALLOWED_LOGO_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Tipo de arquivo não permitido (só JPG ou PNG)');
    }

    const existing = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const oldKey = existing.rows[0]?.logo_file_key ?? null;

    const newKey = `tenants/${tenantId}/branding/logo-${randomUUID()}.${ext}`;
    await this.r2.putObject(newKey, file.buffer, file.mimetype);

    try {
      await client.query('UPDATE tenants SET logo_file_key = $1 WHERE id = $2', [newKey, tenantId]);
    } catch (err) {
      // O objeto já foi gravado no R2 real antes do UPDATE — se o UPDATE
      // falhar, sem isso o objeto ficaria órfão no bucket pra sempre.
      // Mesmo padrão de DocumentsService.upload.
      try {
        await this.r2.deleteObject(newKey);
      } catch {
        // Best-effort: não mascara o erro real do UPDATE.
      }
      throw err;
    }

    if (oldKey) {
      // Best-effort — uma falha aqui não derruba a resposta de sucesso,
      // só deixaria um objeto órfão (aceitável, não é dado sensível).
      try {
        await this.r2.deleteObject(oldKey);
      } catch {
        // Ignorado de propósito.
      }
    }

    return { has_logo: true };
  }

  async removeLogo(client: PoolClient, tenantId: string): Promise<{ has_logo: false }> {
    const existing = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const oldKey = existing.rows[0]?.logo_file_key ?? null;

    if (oldKey) {
      await this.r2.deleteObject(oldKey);
    }
    await client.query('UPDATE tenants SET logo_file_key = NULL WHERE id = $1', [tenantId]);

    return { has_logo: false };
  }

  async getLogoRedirectUrl(client: PoolClient, tenantId: string): Promise<string> {
    const result = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const key = result.rows[0]?.logo_file_key;
    if (!key) throw new NotFoundException('Logo não encontrada');
    return this.r2.getPresignedDownloadUrl(key);
  }
}
