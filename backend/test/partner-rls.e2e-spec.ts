import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS para o papel parceiro (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let inspectionAId: string;
  let itemAId: string;
  let actionPlanAId: string;
  let partnerLinkedUserId: string;
  let partnerLinkedId: string;
  let partnerUnlinkedUserId: string;
  let partnerUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Parceiro RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Parceiro RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Vinculado RLS');
    const unlinkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Nao Vinculado RLS');
    partnerLinkedUserId = linkedPartner.userId;
    partnerUnlinkedUserId = unlinkedPartner.userId;

    const linkedResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerLinkedUserId],
    );
    partnerLinkedId = linkedResult.rows[0].id;

    const unlinkedResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerUnlinkedUserId],
    );
    partnerUnlinkedId = unlinkedResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantAId, partnerLinkedId],
    );

    const insertDocA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR A', 'test-key-partner-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertInspectionA = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    inspectionAId = insertInspectionA.rows[0].id;

    const insertItemA = await (db as any).client.query(
      `INSERT INTO inspection_checklist_items (inspection_id, block, item_key, item_label)
       VALUES ($1, 'documentacao', 'fichas_epi', 'Fichas de EPI em dia') RETURNING id`,
      [inspectionAId],
    );
    itemAId = insertItemA.rows[0].id;

    const insertActionPlanA = await (db as any).client.query(
      `INSERT INTO action_plans (tenant_id, inspection_id, checklist_item_id, description)
       VALUES ($1, $2, $3, 'Fichas de EPI em dia') RETURNING id`,
      [tenantAId, inspectionAId, itemAId],
    );
    actionPlanAId = insertActionPlanA.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM action_plans WHERE id = $1', [actionPlanAId]);
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionAId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [docAId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = ANY($1)', [
      [partnerLinkedId, partnerUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'documents' | 'inspections' | 'action_plans',
  ): Promise<string[]> {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await appClient.query(`SELECT id FROM ${table}`);
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('parceiro vinculado à empresa A vê documents/inspections/action_plans dela', async () => {
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'documents')).toContain(docAId);
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'inspections')).toContain(
      inspectionAId,
    );
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'action_plans')).toContain(
      actionPlanAId,
    );
  });

  it('parceiro NÃO vinculado a nenhuma empresa não vê nada nas três tabelas', async () => {
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'documents')).not.toContain(
      docAId,
    );
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'inspections')).not.toContain(
      inspectionAId,
    );
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'action_plans')).not.toContain(
      actionPlanAId,
    );
  });

  it('vínculo de parceiro não dá acesso via a policy de técnico (papel errado não enxerga)', async () => {
    // Mesmo usuário/vínculo de parceiro, mas contexto de role='tecnico' —
    // não deve enxergar nada, prova que os dois branches são independentes.
    expect(await queryAsContext('tecnico', null, partnerLinkedUserId, 'documents')).not.toContain(docAId);
  });
});
