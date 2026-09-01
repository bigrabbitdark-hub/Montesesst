import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { toDateString } from './committees.service';

export interface CipaMember {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  nome: string;
  funcao_empresa: string | null;
  setor: string | null;
  funcao_cipa: 'presidente' | 'vice_presidente' | 'secretario' | 'membro';
  titular_suplente: 'titular' | 'suplente';
  representacao: 'empregador' | 'empregados';
  inicio_mandato: string;
  fim_mandato: string;
  status: 'ativo' | 'inativo';
  created_at: string;
  updated_at: string;
}

const UPDATABLE_FIELDS = [
  'nome', 'funcao_empresa', 'setor', 'funcao_cipa', 'titular_suplente',
  'representacao', 'inicio_mandato', 'fim_mandato', 'status',
] as const;

// Mesmo padrão de normalização de colunas DATE usado em
// committees.service.ts / meetings.service.ts (toDateString reexportado
// de lá) — cipa_members tem duas colunas DATE (inicio_mandato,
// fim_mandato) que o node-pg devolve como objeto Date.
function normalizeMember(row: CipaMember): CipaMember {
  return {
    ...row,
    inicio_mandato: toDateString(row.inicio_mandato) as string,
    fim_mandato: toDateString(row.fim_mandato) as string,
  };
}

@Injectable()
export class MembersService {
  async create(
    client: PoolClient,
    tenantId: string,
    data: Omit<CipaMember, 'id' | 'tenant_id' | 'status' | 'created_at' | 'updated_at'>,
  ): Promise<CipaMember> {
    // Mesma checagem de CommitteesService.create (Task 1) — sem isso, um
    // company_unit_id de outro tenant passa pelo FK-only e o membro fica
    // vinculado ao estabelecimento errado (a linha em si continua isolada
    // por tenant_id via RLS, mas o dado fica incorreto).
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      data.company_unit_id,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const result = await client.query<CipaMember>(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_empresa, setor, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        tenantId, data.company_unit_id, data.nome, data.funcao_empresa ?? null, data.setor ?? null,
        data.funcao_cipa, data.titular_suplente, data.representacao, data.inicio_mandato, data.fim_mandato,
      ],
    );
    return normalizeMember(result.rows[0]);
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaMember[]> {
    if (companyUnitId) {
      const result = await client.query<CipaMember>(
        'SELECT * FROM cipa_members WHERE company_unit_id = $1 ORDER BY nome',
        [companyUnitId],
      );
      return result.rows.map(normalizeMember);
    }
    const result = await client.query<CipaMember>('SELECT * FROM cipa_members ORDER BY nome');
    return result.rows.map(normalizeMember);
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaMember> {
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
      const result = await client.query<CipaMember>('SELECT * FROM cipa_members WHERE id = $1', [id]);
      const member = result.rows[0];
      if (!member) throw new NotFoundException('Membro não encontrado');
      return normalizeMember(member);
    }

    const result = await client.query<CipaMember>(
      `UPDATE cipa_members SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (result.rows.length === 0) throw new NotFoundException('Membro não encontrado');
    return normalizeMember(result.rows[0]);
  }
}
