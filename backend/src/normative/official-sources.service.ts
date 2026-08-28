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
}

interface CreateOfficialSourceData {
  entity: string;
  code?: string;
  title: string;
  official_url: string;
  active?: boolean;
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
}
