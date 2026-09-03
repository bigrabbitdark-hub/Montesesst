import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaSipatEdition {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  periodo_inicio: string;
  periodo_fim: string;
  tema: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaSipatActivity {
  id: string;
  edition_id: string;
  data: string;
  titulo: string;
  responsavel: string | null;
  publico_alvo: string | null;
  status: 'planejada' | 'realizada' | 'cancelada';
  numero_participantes: number | null;
  created_at: string;
  updated_at: string;
}

function normalizeEdition(row: CipaSipatEdition): CipaSipatEdition {
  return {
    ...row,
    periodo_inicio: toDateString(row.periodo_inicio) as string,
    periodo_fim: toDateString(row.periodo_fim) as string,
  };
}

function normalizeActivity(row: CipaSipatActivity): CipaSipatActivity {
  return { ...row, data: toDateString(row.data) as string };
}

@Injectable()
export class SipatService {
  async createEdition(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    periodoInicio: string,
    periodoFim: string,
    tema: string | undefined,
  ): Promise<CipaSipatEdition> {
    // FOR UPDATE em company_units — mesmo raciocínio de
    // ElectionsService.create, serializa duas criações quase
    // simultâneas pro mesmo estabelecimento+ano. O índice único
    // (0030_cipa_capacitacao.sql) é o backstop de banco.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const dupCheck = await client.query('SELECT 1 FROM cipa_sipat_editions WHERE company_unit_id = $1 AND ano = $2', [
      companyUnitId,
      ano,
    ]);
    if ((dupCheck.rowCount ?? 0) > 0) {
      throw new ConflictException('Já existe uma edição de SIPAT para este ano neste estabelecimento');
    }

    try {
      const result = await client.query<CipaSipatEdition>(
        `INSERT INTO cipa_sipat_editions (tenant_id, company_unit_id, ano, periodo_inicio, periodo_fim, tema)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, companyUnitId, ano, periodoInicio, periodoFim, tema ?? null],
      );
      return normalizeEdition(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findEditions(client: PoolClient, companyUnitId?: string): Promise<CipaSipatEdition[]> {
    if (companyUnitId) {
      const result = await client.query<CipaSipatEdition>(
        'SELECT * FROM cipa_sipat_editions WHERE company_unit_id = $1 ORDER BY ano DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeEdition);
    }
    const result = await client.query<CipaSipatEdition>('SELECT * FROM cipa_sipat_editions ORDER BY ano DESC');
    return result.rows.map(normalizeEdition);
  }

  async removeEdition(client: PoolClient, id: string): Promise<void> {
    // Cascateia pras atividades via FK (ON DELETE CASCADE,
    // 0030_cipa_capacitacao.sql) — não precisa apagar as atividades
    // manualmente aqui.
    const result = await client.query('DELETE FROM cipa_sipat_editions WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Edição de SIPAT não encontrada');
  }

  async addActivity(
    client: PoolClient,
    editionId: string,
    data: string,
    titulo: string,
    responsavel: string | undefined,
    publicoAlvo: string | undefined,
  ): Promise<CipaSipatActivity> {
    const editionCheck = await client.query('SELECT 1 FROM cipa_sipat_editions WHERE id = $1', [editionId]);
    if (editionCheck.rowCount === 0) throw new NotFoundException('Edição de SIPAT não encontrada');

    try {
      const result = await client.query<CipaSipatActivity>(
        `INSERT INTO cipa_sipat_activities (edition_id, data, titulo, responsavel, publico_alvo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [editionId, data, titulo, responsavel ?? null, publicoAlvo ?? null],
      );
      return normalizeActivity(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  // Mesmo padrão de ElectionsService.findCandidates — sem checar
  // existência da edição primeiro, um edition_id inválido/de outro
  // tenant só devolve lista vazia (RLS de cipa_sipat_editions já
  // filtra o que o EXISTS de cipa_sipat_activities_isolation enxerga).
  async findActivities(client: PoolClient, editionId: string): Promise<CipaSipatActivity[]> {
    const result = await client.query<CipaSipatActivity>(
      'SELECT * FROM cipa_sipat_activities WHERE edition_id = $1 ORDER BY data',
      [editionId],
    );
    return result.rows.map(normalizeActivity);
  }

  async updateActivity(
    client: PoolClient,
    editionId: string,
    activityId: string,
    data: { status?: string; numeroParticipantes?: number },
  ): Promise<CipaSipatActivity> {
    // Mesmo padrão de dynamic SET de ElectionsService.updateCandidate —
    // só inclui no SET o que veio de fato no payload.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 3;
    if (data.status !== undefined) {
      setClauses.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.numeroParticipantes !== undefined) {
      setClauses.push(`numero_participantes = $${i++}`);
      values.push(data.numeroParticipantes);
    }

    if (setClauses.length === 0) {
      const result = await client.query<CipaSipatActivity>(
        'SELECT * FROM cipa_sipat_activities WHERE id = $1 AND edition_id = $2',
        [activityId, editionId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Atividade não encontrada');
      return normalizeActivity(row);
    }

    try {
      const result = await client.query<CipaSipatActivity>(
        `UPDATE cipa_sipat_activities SET ${setClauses.join(', ')} WHERE id = $1 AND edition_id = $2 RETURNING *`,
        [activityId, editionId, ...values],
      );
      if (result.rows.length === 0) throw new NotFoundException('Atividade não encontrada');
      return normalizeActivity(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }
}
