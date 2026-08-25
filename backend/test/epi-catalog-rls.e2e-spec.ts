import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('epi_catalog_items semeado + RLS de tenant_epis/employee_epi_deliveries (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let catalogItemId: string;
  let tenantEpiAId: string;
  let deliveryAId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let partnerLinkedUserId: string;
  let partnerLinkedId: string;
  let unlinkedUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();

    const catalogResult = await (db as any).client.query(
      "SELECT id FROM epi_catalog_items WHERE code = 'A.1' LIMIT 1",
    );
    catalogItemId = catalogResult.rows[0].id;

    const tenantA = await db.createTenantWithUser('Empresa EpiCatalog RLS A');
    const tenantB = await db.createTenantWithUser('Empresa EpiCatalog RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico EpiCatalog RLS');
    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro EpiCatalog RLS');
    const unlinked = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado EpiCatalog RLS');
    technicianLinkedUserId = linkedTech.userId;
    partnerLinkedUserId = linkedPartner.userId;
    unlinkedUserId = unlinked.userId;

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianLinkedUserId],
    );
    technicianLinkedId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianLinkedId],
    );

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerLinkedUserId],
    );
    partnerLinkedId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantAId, partnerLinkedId],
    );

    const insertEpiA = await (db as any).client.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
       VALUES ($1, $2, 'CA-TESTE-001', $3) RETURNING id`,
      [tenantAId, catalogItemId, tenantA.userId],
    );
    tenantEpiAId = insertEpiA.rows[0].id;

    const insertDeliveryA = await (db as any).client.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id)
       VALUES ($1, $2, $3, '2026-08-25', 'Fulano de Tal', $4) RETURNING id`,
      [tenantAId, tenantEpiAId, tenantA.employeeId, tenantA.userId],
    );
    deliveryAId = insertDeliveryA.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM employee_epi_deliveries WHERE id = $1', [deliveryAId]);
    await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [tenantEpiAId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianLinkedId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerLinkedId]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'tenant_epis' | 'employee_epi_deliveries',
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

  it('empresa A vê o próprio tenant_epis/employee_epi_deliveries; empresa B não', async () => {
    expect(await queryAsContext('empresa', tenantAId, randomUUID(), 'tenant_epis')).toContain(tenantEpiAId);
    expect(await queryAsContext('empresa', tenantBId, randomUUID(), 'tenant_epis')).not.toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('empresa', tenantAId, randomUUID(), 'employee_epi_deliveries')).toContain(
      deliveryAId,
    );
  });

  it('técnico vinculado à empresa A vê; parceiro vinculado à empresa A também vê', async () => {
    expect(await queryAsContext('tecnico', null, technicianLinkedUserId, 'tenant_epis')).toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'tenant_epis')).toContain(
      tenantEpiAId,
    );
  });

  it('técnico NÃO vinculado a nenhuma empresa não vê nada', async () => {
    expect(await queryAsContext('tecnico', null, unlinkedUserId, 'tenant_epis')).not.toContain(
      tenantEpiAId,
    );
    expect(await queryAsContext('tecnico', null, unlinkedUserId, 'employee_epi_deliveries')).not.toContain(
      deliveryAId,
    );
  });
});
