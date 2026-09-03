import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

// Coluna DATE do Postgres — node-pg devolve um objeto Date (não
// string) fora de um contexto que passe por JSON.stringify. Mesmo
// padrão já usado localmente em cada módulo deste projeto (ex.
// dashboard.service.ts) — não importado de outro módulo, já que é
// uma função de 3 linhas sem motivo pra criar uma dependência cruzada
// entre caepi (dado público, sem tenant) e um módulo não relacionado.
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

export interface CaepiRecord {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  numero_processo: string | null;
  cnpj: string | null;
  razao_social: string | null;
  natureza: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  referencia: string | null;
  cor: string | null;
  aprovado_laudo: string | null;
  restricao_laudo: string | null;
  observacao_laudo: string | null;
  cnpj_laboratorio: string | null;
  razao_social_laboratorio: string | null;
  numero_laudo: string | null;
  norma: string | null;
}

export interface CaepiSyncStatus {
  last_synced_at: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
}

function normalizeRecord(row: CaepiRecord): CaepiRecord {
  return { ...row, data_validade: toDateString(row.data_validade) };
}

@Injectable()
export class CaepiService {
  constructor(private readonly db: DatabaseService) {}

  // Sem contexto de tenant — caepi_records não tem RLS, é dado
  // público. Mesmo raciocínio já documentado em
  // DatabaseService.withoutTenantContext.
  async search(q: string): Promise<CaepiRecord[]> {
    const pattern = `%${q}%`;
    const result = await this.db.withoutTenantContext((client) =>
      client.query<CaepiRecord>(
        `SELECT * FROM caepi_records
         WHERE numero_ca = $1
            OR equipamento ILIKE $2
            OR descricao_equipamento ILIKE $2
            OR marca_ca ILIKE $2
            OR razao_social ILIKE $2
         ORDER BY (numero_ca = $1) DESC, equipamento
         LIMIT 50`,
        [q, pattern],
      ),
    );
    return result.rows.map(normalizeRecord);
  }

  async getSyncStatus(): Promise<CaepiSyncStatus> {
    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ last_synced_at: string; rows_imported: number; rows_skipped: number }>(
        'SELECT last_synced_at, rows_imported, rows_skipped FROM caepi_sync_status WHERE id = 1',
      ),
    );
    const row = result.rows[0];
    if (!row) {
      // Sincronização nunca rodou neste ambiente — estado válido e
      // esperado logo após o deploy inicial desta fase, não um erro.
      return { last_synced_at: null, rows_imported: null, rows_skipped: null };
    }
    return {
      last_synced_at: new Date(row.last_synced_at).toISOString(),
      rows_imported: row.rows_imported,
      rows_skipped: row.rows_skipped,
    };
  }
}
