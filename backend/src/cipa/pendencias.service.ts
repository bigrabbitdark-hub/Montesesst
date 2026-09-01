import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { toDateString } from './committees.service';

export interface CipaPendencia {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  meeting_id: string | null;
  descricao: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'aberta' | 'andamento' | 'concluida' | 'atrasada';
  created_at: string;
  updated_at: string;
}

const UPDATABLE_FIELDS = ['descricao', 'responsavel_user_id', 'prazo', 'prioridade', 'status'] as const;

// Mesmo padrão de normalização de colunas DATE usado em
// committees.service.ts / meetings.service.ts / members.service.ts
// (toDateString reexportado de committees.service.ts) — cipa_pendencias
// tem uma coluna DATE (prazo) que o node-pg devolve como objeto Date.
function normalizePendencia(row: CipaPendencia): CipaPendencia {
  return {
    ...row,
    prazo: toDateString(row.prazo),
  };
}

@Injectable()
export class PendenciasService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    meetingId: string | undefined,
    descricao: string,
    responsavelUserId: string | undefined,
    prazo: string | undefined,
    prioridade: string | undefined,
  ): Promise<CipaPendencia> {
    // Mesma checagem de CommitteesService.create / MembersService.create —
    // achado da revisão de Task 4: sem isso, um company_unit_id de outro
    // tenant passa pelo FK-only e a pendência fica vinculada ao
    // estabelecimento errado.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    // Mesma checagem, mesmo motivo (FK-only não impede cross-tenant sob
    // RLS — a FK verifica só que a linha existe, não que ela pertence ao
    // tenant do caller): meeting_id é opcional (é o que permite esta
    // tabela unificar plano de ação nascido de reunião e pendência
    // avulsa), mas quando informado precisa pertencer ao mesmo tenant.
    if (meetingId) {
      const meetingCheck = await client.query('SELECT 1 FROM cipa_meetings WHERE id = $1 AND tenant_id = $2', [
        meetingId,
        tenantId,
      ]);
      if (meetingCheck.rowCount === 0) {
        throw new BadRequestException('Reunião inválida para esta empresa');
      }
    }

    const result = await client.query<CipaPendencia>(
      `INSERT INTO cipa_pendencias (tenant_id, company_unit_id, meeting_id, descricao, responsavel_user_id, prazo, prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'media')) RETURNING *`,
      [tenantId, companyUnitId, meetingId ?? null, descricao, responsavelUserId ?? null, prazo ?? null, prioridade ?? null],
    );
    return normalizePendencia(result.rows[0]);
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaPendencia[]> {
    if (companyUnitId) {
      const result = await client.query<CipaPendencia>(
        'SELECT * FROM cipa_pendencias WHERE company_unit_id = $1 ORDER BY prazo NULLS LAST, created_at',
        [companyUnitId],
      );
      return result.rows.map(normalizePendencia);
    }
    const result = await client.query<CipaPendencia>(
      'SELECT * FROM cipa_pendencias ORDER BY prazo NULLS LAST, created_at',
    );
    return result.rows.map(normalizePendencia);
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaPendencia> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      const result = await client.query<CipaPendencia>('SELECT * FROM cipa_pendencias WHERE id = $1', [id]);
      const pendencia = result.rows[0];
      if (!pendencia) throw new NotFoundException('Pendência não encontrada');
      return normalizePendencia(pendencia);
    }

    const result = await client.query<CipaPendencia>(
      `UPDATE cipa_pendencias SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (result.rows.length === 0) throw new NotFoundException('Pendência não encontrada');
    return normalizePendencia(result.rows[0]);
  }
}
