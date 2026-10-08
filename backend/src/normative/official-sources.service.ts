import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface OfficialSource {
  id: string;
  entity: string;
  code: string | null;
  title: string;
  official_url: string;
  active: boolean;
  created_at: string;
  // Estado da última verificação do monitor (migration 0050).
  last_checked_at: string | null;
  last_check_status: 'ok' | 'erro' | null;
  last_error: string | null;
  consecutive_failures: number;
}

interface CreateOfficialSourceData {
  entity: string;
  code?: string;
  title: string;
  official_url: string;
  active?: boolean;
}

interface UpdateOfficialSourceData {
  entity?: string;
  code?: string;
  title?: string;
  official_url?: string;
  active?: boolean;
}

// URL normalizada para achar fontes duplicadas: minúsculas, sem #fragmento e sem barra final.
function normalizarUrl(url: string): string {
  return url.trim().split('#')[0].replace(/\/+$/, '').toLowerCase();
}

@Injectable()
export class OfficialSourcesService {
  async create(client: PoolClient, data: CreateOfficialSourceData): Promise<OfficialSource> {
    const result = await client.query<OfficialSource>(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.entity, data.code ?? null, data.title, data.official_url, data.active ?? true],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient): Promise<OfficialSource[]> {
    const result = await client.query<OfficialSource>('SELECT * FROM official_sources ORDER BY entity, code');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<OfficialSource | null> {
    const result = await client.query<OfficialSource>('SELECT * FROM official_sources WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async update(client: PoolClient, id: string, data: UpdateOfficialSourceData): Promise<OfficialSource | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (coluna: string, valor: unknown) => {
      params.push(valor);
      sets.push(`${coluna} = $${params.length}`);
    };
    if (data.entity !== undefined) add('entity', data.entity);
    if (data.title !== undefined) add('title', data.title);
    if (data.code !== undefined) add('code', data.code.trim() === '' ? null : data.code);
    if (data.active !== undefined) add('active', data.active);
    if (data.official_url !== undefined) {
      params.push(data.official_url);
      const n = params.length;
      // Trocar a URL zera o estado da última verificação (era de outra página). No UPDATE, o lado
      // direito vê a linha ANTIGA, então o CASE compara a URL de antes com a nova.
      sets.push(
        `last_check_status = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_check_status END`,
        `last_checked_at = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_checked_at END`,
        `last_error = CASE WHEN official_url IS DISTINCT FROM $${n} THEN NULL ELSE last_error END`,
        `consecutive_failures = CASE WHEN official_url IS DISTINCT FROM $${n} THEN 0 ELSE consecutive_failures END`,
        `official_url = $${n}`,
      );
    }
    if (sets.length === 0) return this.findOne(client, id);

    const result = await client.query<OfficialSource>(
      `UPDATE official_sources SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return result.rows[0] ?? null;
  }

  async findByUrl(client: PoolClient, url: string): Promise<{ id: string; title: string; code: string | null } | null> {
    const result = await client.query<{ id: string; title: string; code: string | null }>(
      `SELECT id, title, code FROM official_sources
       WHERE lower(regexp_replace(split_part(official_url, '#', 1), '/+$', '')) = $1
       LIMIT 1`,
      [normalizarUrl(url)],
    );
    return result.rows[0] ?? null;
  }
}
