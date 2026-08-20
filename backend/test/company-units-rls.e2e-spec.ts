import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em company_units (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let unitAId: string;
  let unitBId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Filial A');
    const tenantB = await db.createTenantWithUser('Empresa Filial B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const insertA = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Sede A', 'Rua A', 'Criciúma', 'SC', '88801000') RETURNING id`,
      [tenantAId],
    );
    unitAId = insertA.rows[0].id;

    const insertB = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Sede B', 'Rua B', 'Criciúma', 'SC', '88802000') RETURNING id`,
      [tenantBId],
    );
    unitBId = insertB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_units WHERE id = ANY($1)', [
      [unitAId, unitBId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  it('empresa A só vê a própria filial via RLS, nunca a de empresa B', async () => {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', randomUUID()]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantAId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', 'empresa']);

      const result = await appClient.query('SELECT id, tenant_id FROM company_units');
      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(unitAId);
      expect(ids).not.toContain(unitBId);

      await appClient.query('ROLLBACK');
    } finally {
      await appClient.end();
    }
  });
});
