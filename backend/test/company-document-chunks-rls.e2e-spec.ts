import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em company_document_chunks (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let docBId: string;
  let chunkAId: string;
  let chunkBId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Chunk RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Chunk RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Chunk RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Chunk RLS');
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
       VALUES ($1, 'pgr', 'PGR A', 'test-key-chunk-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertDocB = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR B', 'test-key-chunk-b', 'b.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantBId, tenantB.userId],
    );
    docBId = insertDocB.rows[0].id;

    const zeroVector = `[${new Array(1536).fill(0).join(',')}]`;
    const chunkA = await (db as any).client.query(
      `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
       VALUES ($1, $2, 'pgr', 0, 'Trecho do PGR da empresa A', $3::vector) RETURNING id`,
      [tenantAId, docAId, zeroVector],
    );
    chunkAId = chunkA.rows[0].id;

    const chunkB = await (db as any).client.query(
      `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
       VALUES ($1, $2, 'pgr', 0, 'Trecho do PGR da empresa B', $3::vector) RETURNING id`,
      [tenantBId, docBId, zeroVector],
    );
    chunkBId = chunkB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_document_chunks WHERE id = ANY($1)', [
      [chunkAId, chunkBId],
    ]);
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
      const result = await appClient.query('SELECT id FROM company_document_chunks');
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('empresa A só vê o próprio chunk via RLS, nunca o de empresa B', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID());
    expect(ids).toContain(chunkAId);
    expect(ids).not.toContain(chunkBId);
  });

  it('técnico vinculado à empresa A vê o chunk dela', async () => {
    const ids = await queryAsContext('tecnico', null, technicianLinkedUserId);
    expect(ids).toContain(chunkAId);
  });

  it('técnico NÃO vinculado a nenhuma empresa não vê chunk nenhum', async () => {
    const ids = await queryAsContext('tecnico', null, technicianUnlinkedUserId);
    expect(ids).not.toContain(chunkAId);
    expect(ids).not.toContain(chunkBId);
  });
});
