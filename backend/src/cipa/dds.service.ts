import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaDdsRecord {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  data: string;
  tema: string;
  numero_participantes: number | null;
  responsavel: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeDds(row: CipaDdsRecord): CipaDdsRecord {
  return { ...row, data: toDateString(row.data) as string };
}

@Injectable()
export class DdsService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    data: {
      data: string;
      tema: string;
      numeroParticipantes?: number;
      responsavel?: string;
      observacoes?: string;
    },
  ): Promise<CipaDdsRecord> {
    // Mesma checagem de CommitteesService.create/ElectionsService.create
    // — FK sozinho não impede company_unit_id de outro tenant sob RLS.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    try {
      const result = await client.query<CipaDdsRecord>(
        `INSERT INTO cipa_dds_records (tenant_id, company_unit_id, data, tema, numero_participantes, responsavel, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          companyUnitId,
          data.data,
          data.tema,
          data.numeroParticipantes ?? null,
          data.responsavel ?? null,
          data.observacoes ?? null,
        ],
      );
      return normalizeDds(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaDdsRecord[]> {
    if (companyUnitId) {
      const result = await client.query<CipaDdsRecord>(
        'SELECT * FROM cipa_dds_records WHERE company_unit_id = $1 ORDER BY data DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeDds);
    }
    const result = await client.query<CipaDdsRecord>('SELECT * FROM cipa_dds_records ORDER BY data DESC');
    return result.rows.map(normalizeDds);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM cipa_dds_records WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Registro de DDS não encontrado');
  }
}
