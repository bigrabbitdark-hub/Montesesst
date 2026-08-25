import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em inspections/inspection_checklist_items/action_plans (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let inspectionAId: string;
  let inspectionBId: string;
  let itemAId: string;
  let actionPlanAId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Inspection RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Inspection RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Inspection RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Inspection RLS');
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

    const insertInspectionA = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantAId, technicianLinkedUserId],
    );
    inspectionAId = insertInspectionA.rows[0].id;

    const insertInspectionB = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantBId, technicianUnlinkedUserId],
    );
    inspectionBId = insertInspectionB.rows[0].id;

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
    await (db as any).client.query('DELETE FROM inspections WHERE id = ANY($1)', [
      [inspectionAId, inspectionBId],
    ]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'inspections' | 'inspection_checklist_items' | 'action_plans',
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

  it('empresa A só vê a própria inspeção via RLS, nunca a de empresa B', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID(), 'inspections');
    expect(ids).toContain(inspectionAId);
    expect(ids).not.toContain(inspectionBId);
  });

  it('técnico vinculado à empresa A vê a inspeção dela; técnico não vinculado não vê nenhuma', async () => {
    const linkedIds = await queryAsContext('tecnico', null, technicianLinkedUserId, 'inspections');
    expect(linkedIds).toContain(inspectionAId);

    const unlinkedIds = await queryAsContext('tecnico', null, technicianUnlinkedUserId, 'inspections');
    expect(unlinkedIds).not.toContain(inspectionAId);
    expect(unlinkedIds).not.toContain(inspectionBId);
  });

  it('inspection_checklist_items herda a visibilidade de inspections', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID(), 'inspection_checklist_items');
    expect(ids).toContain(itemAId);

    const otherTenantIds = await queryAsContext('empresa', tenantBId, randomUUID(), 'inspection_checklist_items');
    expect(otherTenantIds).not.toContain(itemAId);
  });

  it('action_plans segue o mesmo isolamento de tenant/técnico vinculado', async () => {
    const ownerIds = await queryAsContext('empresa', tenantAId, randomUUID(), 'action_plans');
    expect(ownerIds).toContain(actionPlanAId);

    const otherTenantIds = await queryAsContext('empresa', tenantBId, randomUUID(), 'action_plans');
    expect(otherTenantIds).not.toContain(actionPlanAId);

    const unlinkedTechIds = await queryAsContext('tecnico', null, technicianUnlinkedUserId, 'action_plans');
    expect(unlinkedTechIds).not.toContain(actionPlanAId);
  });
});
