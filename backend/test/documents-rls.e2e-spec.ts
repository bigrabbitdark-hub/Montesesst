import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em documents (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let docBId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Doc RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Doc RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado RLS');
    technicianLinkedUserId = linkedTech.userId;
    technicianUnlinkedUserId = unlinkedTech.userId;

    const linkedResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianLinkedUserId],
    );
    technicianLinkedId = linkedResult.rows[0].id;

    const unlinkedResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianUnlinkedUserId],
    );
    technicianUnlinkedId = unlinkedResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianLinkedId],
    );

    const insertDocA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR A', 'test-key-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertDocB = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR B', 'test-key-b', 'b.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantBId, tenantB.userId],
    );
    docBId = insertDocB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[docAId, docBId]]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(role: string, tenantId: string | null, userId: string): Promise<string[]> {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await appClient.query('SELECT id FROM documents');
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('empresa A só vê o próprio documento via RLS, nunca o de empresa B', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID());
    expect(ids).toContain(docAId);
    expect(ids).not.toContain(docBId);
  });

  it('técnico vinculado à empresa A vê o documento dela', async () => {
    const ids = await queryAsContext('tecnico', null, technicianLinkedUserId);
    expect(ids).toContain(docAId);
  });

  it('técnico NÃO vinculado a nenhuma empresa não vê documento nenhum', async () => {
    const ids = await queryAsContext('tecnico', null, technicianUnlinkedUserId);
    expect(ids).not.toContain(docAId);
    expect(ids).not.toContain(docBId);
  });
});
