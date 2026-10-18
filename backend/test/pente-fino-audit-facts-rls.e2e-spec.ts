import { Client } from 'pg';
import { TestDb } from './db-test-helper';

describe('RLS de sst_audit_document_extractions e sst_audit_facts', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let companyAUserId: string;
  let companyBUserId: string;
  let documentAId: string;
  let documentBId: string;
  let extractionAId: string;
  let extractionBId: string;
  let factAId: string;
  let factBId: string;
  let linkedTechnicianUserId: string;
  let linkedTechnicianId: string;
  let unlinkedTechnicianUserId: string;
  let unlinkedTechnicianId: string;
  let linkedPartnerUserId: string;
  let linkedPartnerId: string;
  let unlinkedPartnerUserId: string;
  let unlinkedPartnerId: string;
  let adminUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();

    const companyA = await db.createTenantWithUser('Empresa Auditoria Facts A');
    const companyB = await db.createTenantWithUser('Empresa Auditoria Facts B');
    tenantAId = companyA.tenantId;
    tenantBId = companyB.tenantId;
    companyAUserId = companyA.userId;
    companyBUserId = companyB.userId;

    const linkedTechnician = await db.createUserWithRole('tecnico', 'Tecnico Auditoria Facts Vinculado');
    const unlinkedTechnician = await db.createUserWithRole('tecnico', 'Tecnico Auditoria Facts Sem Vinculo');
    linkedTechnicianUserId = linkedTechnician.userId;
    unlinkedTechnicianUserId = unlinkedTechnician.userId;
    const linkedTechnicianRow = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [linkedTechnicianUserId],
    );
    const unlinkedTechnicianRow = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [unlinkedTechnicianUserId],
    );
    linkedTechnicianId = linkedTechnicianRow.rows[0].id;
    unlinkedTechnicianId = unlinkedTechnicianRow.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, linkedTechnicianId],
    );

    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Auditoria Facts Vinculado');
    const unlinkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Auditoria Facts Sem Vinculo');
    linkedPartnerUserId = linkedPartner.userId;
    unlinkedPartnerUserId = unlinkedPartner.userId;
    const linkedPartnerRow = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [linkedPartnerUserId],
    );
    const unlinkedPartnerRow = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [unlinkedPartnerUserId],
    );
    linkedPartnerId = linkedPartnerRow.rows[0].id;
    unlinkedPartnerId = unlinkedPartnerRow.rows[0].id;
    await (db as any).client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [
      tenantAId,
      linkedPartnerId,
    ]);

    const admin = await db.createUserWithRole('admin', 'Admin Auditoria Facts RLS');
    adminUserId = admin.userId;

    const documentA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Facts A', 'fixture/audit-facts-a.pdf', 'pgr-a.pdf', 'application/pdf', 10, $2, 'empresa') RETURNING id`,
      [tenantAId, companyAUserId],
    );
    const documentB = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Facts B', 'fixture/audit-facts-b.pdf', 'pgr-b.pdf', 'application/pdf', 10, $2, 'empresa') RETURNING id`,
      [tenantBId, companyBUserId],
    );
    documentAId = documentA.rows[0].id;
    documentBId = documentB.rows[0].id;

    const extractionA = await (db as any).client.query(
      `INSERT INTO sst_audit_document_extractions
         (tenant_id, document_id, document_sha256, extractor_version, page_count, status)
       VALUES ($1, $2, $3, 'test-1', 1, 'complete') RETURNING id`,
      [tenantAId, documentAId, 'a'.repeat(64)],
    );
    const extractionB = await (db as any).client.query(
      `INSERT INTO sst_audit_document_extractions
         (tenant_id, document_id, document_sha256, extractor_version, page_count, status)
       VALUES ($1, $2, $3, 'test-1', 1, 'complete') RETURNING id`,
      [tenantBId, documentBId, 'b'.repeat(64)],
    );
    extractionAId = extractionA.rows[0].id;
    extractionBId = extractionB.rows[0].id;

    const factA = await (db as any).client.query(
      `INSERT INTO sst_audit_facts
         (tenant_id, extraction_id, document_id, fact_type, subject_type, subject_raw, subject_key, value_json, evidence_kind, confidence, page_number, source_excerpt)
       VALUES ($1, $2, $3, 'risk', 'function', 'Montador', 'montador', '{"agent":"ruido"}', 'quoted_claim', 'high', 1, 'Ruído no setor Montagem') RETURNING id`,
      [tenantAId, extractionAId, documentAId],
    );
    const factB = await (db as any).client.query(
      `INSERT INTO sst_audit_facts
         (tenant_id, extraction_id, document_id, fact_type, subject_type, subject_raw, subject_key, value_json, evidence_kind, confidence, page_number, source_excerpt)
       VALUES ($1, $2, $3, 'risk', 'function', 'Montador', 'montador', '{"agent":"ruido"}', 'quoted_claim', 'high', 1, 'Ruído no setor Montagem') RETURNING id`,
      [tenantBId, extractionBId, documentBId],
    );
    factAId = factA.rows[0].id;
    factBId = factB.rows[0].id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.cleanup();
    await db.disconnect();
  });

  async function visibleFactIds(role: string, tenantId: string | null, userId: string): Promise<string[]> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await client.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await client.query('SELECT id FROM sst_audit_facts ORDER BY id');
      await client.query('ROLLBACK');
      return result.rows.map((row) => row.id);
    } finally {
      await client.end();
    }
  }

  it('empresa vê fatos do próprio tenant, nunca de outra empresa', async () => {
    const ids = await visibleFactIds('empresa', tenantAId, companyAUserId);
    expect(ids).toContain(factAId);
    expect(ids).not.toContain(factBId);
  });

  it('técnico e parceiro vinculados veem somente fatos da empresa vinculada', async () => {
    const technicianIds = await visibleFactIds('tecnico', null, linkedTechnicianUserId);
    const partnerIds = await visibleFactIds('parceiro', null, linkedPartnerUserId);
    expect(technicianIds).toContain(factAId);
    expect(technicianIds).not.toContain(factBId);
    expect(partnerIds).toContain(factAId);
    expect(partnerIds).not.toContain(factBId);
  });

  it('técnico e parceiro sem vínculo não veem fatos de nenhum tenant', async () => {
    expect(await visibleFactIds('tecnico', null, unlinkedTechnicianUserId)).toEqual([]);
    expect(await visibleFactIds('parceiro', null, unlinkedPartnerUserId)).toEqual([]);
  });

  it('admin consegue auditar os dois tenants', async () => {
    const ids = await visibleFactIds('admin', null, adminUserId);
    expect(ids).toContain(factAId);
    expect(ids).toContain(factBId);
  });

  it('extrações e fatos exigem RLS ativa e forçada', async () => {
    const result = await (db as any).client.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = ANY($1) ORDER BY relname`,
      [['sst_audit_document_extractions', 'sst_audit_facts']],
    );
    expect(result.rows).toEqual([
      { relname: 'sst_audit_document_extractions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'sst_audit_facts', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});