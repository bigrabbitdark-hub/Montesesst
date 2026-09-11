import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em pgr_function_risks/pcmso_function_exams (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let docBId: string;
  let riskAId: string;
  let riskBId: string;
  let examAId: string;
  let examBId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;
  let partnerLinkedUserId: string;
  let partnerLinkedId: string;
  let partnerUnlinkedUserId: string;
  let partnerUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa PenteFino RLS A');
    const tenantB = await db.createTenantWithUser('Empresa PenteFino RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado PenteFino RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado PenteFino RLS');
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

    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Vinculado PenteFino RLS');
    const unlinkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Nao Vinculado PenteFino RLS');
    partnerLinkedUserId = linkedPartner.userId;
    partnerUnlinkedUserId = unlinkedPartner.userId;

    const linkedPartnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerLinkedUserId],
    );
    partnerLinkedId = linkedPartnerResult.rows[0].id;

    const unlinkedPartnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerUnlinkedUserId],
    );
    partnerUnlinkedId = unlinkedPartnerResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantAId, partnerLinkedId],
    );

    const insertDocA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR A', 'test-key-pf-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertDocB = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR B', 'test-key-pf-b', 'b.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantBId, tenantB.userId],
    );
    docBId = insertDocB.rows[0].id;

    const riskA = await (db as any).client.query(
      `INSERT INTO pgr_function_risks (tenant_id, document_id, function_text_raw, risk_description, source_excerpt)
       VALUES ($1, $2, 'Soldador', 'Fumos metálicos', 'trecho A') RETURNING id`,
      [tenantAId, docAId],
    );
    riskAId = riskA.rows[0].id;

    const riskB = await (db as any).client.query(
      `INSERT INTO pgr_function_risks (tenant_id, document_id, function_text_raw, risk_description, source_excerpt)
       VALUES ($1, $2, 'Soldador', 'Fumos metálicos', 'trecho B') RETURNING id`,
      [tenantBId, docBId],
    );
    riskBId = riskB.rows[0].id;

    const examA = await (db as any).client.query(
      `INSERT INTO pcmso_function_exams (tenant_id, document_id, function_text_raw, exam_description, source_excerpt)
       VALUES ($1, $2, 'Soldador', 'Exame respiratório', 'trecho A') RETURNING id`,
      [tenantAId, docAId],
    );
    examAId = examA.rows[0].id;

    const examB = await (db as any).client.query(
      `INSERT INTO pcmso_function_exams (tenant_id, document_id, function_text_raw, exam_description, source_excerpt)
       VALUES ($1, $2, 'Soldador', 'Exame respiratório', 'trecho B') RETURNING id`,
      [tenantBId, docBId],
    );
    examBId = examB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM pgr_function_risks WHERE id = ANY($1)', [[riskAId, riskBId]]);
    await (db as any).client.query('DELETE FROM pcmso_function_exams WHERE id = ANY($1)', [[examAId, examBId]]);
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[docAId, docBId]]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
    await (db as any).client.query('DELETE FROM partners WHERE id = ANY($1)', [
      [partnerLinkedId, partnerUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(table: string, role: string, tenantId: string | null, userId: string): Promise<string[]> {
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

  for (const table of ['pgr_function_risks', 'pcmso_function_exams']) {
    // idA/idB são resolvidos dentro de cada it(), não aqui no corpo do for:
    // este for roda de forma síncrona durante a coleta dos testes (avaliação
    // do describe), antes do beforeAll popular riskAId/riskBId/examAId/examBId —
    // resolver aqui capturaria undefined.
    const getExpectedIds = (): [string, string] =>
      table === 'pgr_function_risks' ? [riskAId, riskBId] : [examAId, examBId];

    it(`${table}: empresa A só vê a própria linha via RLS, nunca a de empresa B`, async () => {
      const [idA, idB] = getExpectedIds();
      const ids = await queryAsContext(table, 'empresa', tenantAId, randomUUID());
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
    });

    it(`${table}: técnico vinculado à empresa A vê a linha dela`, async () => {
      const [idA] = getExpectedIds();
      const ids = await queryAsContext(table, 'tecnico', null, technicianLinkedUserId);
      expect(ids).toContain(idA);
    });

    it(`${table}: técnico NÃO vinculado a nenhuma empresa não vê linha nenhuma`, async () => {
      const [idA, idB] = getExpectedIds();
      const ids = await queryAsContext(table, 'tecnico', null, technicianUnlinkedUserId);
      expect(ids).not.toContain(idA);
      expect(ids).not.toContain(idB);
    });

    it(`${table}: parceiro vinculado à empresa A vê a linha dela`, async () => {
      const [idA, idB] = getExpectedIds();
      const ids = await queryAsContext(table, 'parceiro', null, partnerLinkedUserId);
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
    });

    it(`${table}: parceiro NÃO vinculado a nenhuma empresa não vê linha nenhuma`, async () => {
      const [idA, idB] = getExpectedIds();
      const ids = await queryAsContext(table, 'parceiro', null, partnerUnlinkedUserId);
      expect(ids).not.toContain(idA);
      expect(ids).not.toContain(idB);
    });
  }
});
