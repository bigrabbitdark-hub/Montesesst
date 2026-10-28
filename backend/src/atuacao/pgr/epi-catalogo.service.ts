import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

// Catálogo global de EPI (NR-06, Anexo I): tabela sem tenant_id e sem RLS; somente leitura e só colunas de catálogo.
@Injectable()
export class EpiCatalogoService {
  async listar(c: PoolClient, q?: string) {
    const p: unknown[] = [];
    let where = '';
    if (q) {
      p.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where = `WHERE (description ILIKE $1 OR equipment_group ILIKE $1 OR code ILIKE $1)`;
    }
    return (await c.query(
      `SELECT id, category, code, equipment_group, description, risk_protected, related_nr
         FROM epi_catalog_items ${where} ORDER BY category, code, lower(description), id LIMIT 200`, p,
    )).rows;
  }
}
