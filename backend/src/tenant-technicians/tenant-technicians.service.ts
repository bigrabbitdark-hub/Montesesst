import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

export interface LinkedTechnician {
  user_id: string;
  full_name: string;
  role: 'tecnico' | 'parceiro';
}

@Injectable()
export class TenantTechniciansService {
  async findMyTenants(
    client: PoolClient,
    userId: string,
    role: 'tecnico' | 'parceiro',
  ): Promise<LinkedTenant[]> {
    const linkTable = role === 'tecnico' ? 'tenant_technicians' : 'tenant_partners';
    const linkColumn = role === 'tecnico' ? 'technician_id' : 'partner_id';
    const personTable = role === 'tecnico' ? 'technicians' : 'partners';

    const result = await client.query<LinkedTenant>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.cnpj AS tenant_cnpj
       FROM ${linkTable} lt
       JOIN ${personTable} p ON p.id = lt.${linkColumn}
       JOIN tenants t ON t.id = lt.tenant_id
       WHERE p.user_id = $1
       ORDER BY t.name`,
      [userId],
    );
    return result.rows;
  }

  // DIVERGÊNCIA do brief da Task 1: um JOIN direto em `users` aqui (como o
  // brief descrevia) roda sob `users_isolation`, que só libera uma linha de
  // `users` pra um caller 'empresa' quando `tenant_id` da própria linha bate
  // com o tenant do caller — e a linha de `users` de um técnico/parceiro tem
  // `tenant_id` NULL (entidade global). Resultado real, confirmado rodando o
  // teste e2e desta task: 200 com array vazio, não erro. Mesma armadilha já
  // documentada em technicians.service.ts (findAll/findOne), cujo remédio —
  // LEFT JOIN — só evita a linha sumir, mas não repõe full_name (continua
  // NULL). Usa `linked_technicians_for_tenant`, função SECURITY DEFINER
  // adicionada em 0047_visit_scheduling_fields.sql com a mesma técnica já
  // usada em 0001_init.sql (technician_ids_for_tenant, current_technician_id
  // etc.) pra quebrar RLS cruzada entre tabelas de forma controlada — o
  // único parâmetro é o tenantId do próprio caller autenticado.
  async findMyTechnicians(client: PoolClient, tenantId: string): Promise<LinkedTechnician[]> {
    const result = await client.query<LinkedTechnician>(
      `SELECT * FROM linked_technicians_for_tenant($1)`,
      [tenantId],
    );
    return result.rows;
  }
}
