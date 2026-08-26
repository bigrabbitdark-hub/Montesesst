import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_full_name: string | null;
  actor_role: string | null;
  actor_tenant_id: string | null;
  actor_tenant_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
  detail: string | null;
}

export interface FindAllParams {
  limit: number;
  offset: number;
  resourceType?: string;
  tenantId?: string;
}

// Só admin chama este service (@Roles('admin') no controller) — LEFT JOIN
// é deliberado, não INNER: actor_user_id/actor_tenant_id são legitimamente
// NULL em eventos reais (login_failure sem usuário resolvido, ação de
// tecnico/parceiro sem tenant) e um INNER JOIN descartaria essas linhas
// silenciosamente, mesma classe de bug já corrigida em technicians/partners
// na Fase 7A.
@Injectable()
export class AuditLogService {
  async findAll(client: PoolClient, params: FindAllParams): Promise<AuditLogRow[]> {
    const result = await client.query<AuditLogRow>(
      `SELECT al.*, u.full_name AS actor_full_name, t.name AS actor_tenant_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_user_id
       LEFT JOIN tenants t ON t.id = al.actor_tenant_id
       WHERE ($3::text IS NULL OR al.resource_type = $3)
         AND ($4::uuid IS NULL OR al.actor_tenant_id = $4)
       ORDER BY al.occurred_at DESC
       LIMIT $1 OFFSET $2`,
      [params.limit, params.offset, params.resourceType ?? null, params.tenantId ?? null],
    );
    return result.rows;
  }
}
