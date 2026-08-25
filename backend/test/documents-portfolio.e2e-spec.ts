import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Carteira do técnico — compliance/portfolio e agenda agregada (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let tenantCId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  const insertedDocIds: string[] = [];

  function isoDateDaysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function insertDocument(
    tenantId: string,
    uploaderUserId: string,
    category: string,
    title: string,
    expiresAt: string | null,
  ): Promise<string> {
    const result = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, $3, 'test-key', 'test.pdf', 'application/pdf', 100, $4, $5, 'empresa')
       RETURNING id`,
      [tenantId, category, title, expiresAt, uploaderUserId],
    );
    const id = result.rows[0].id;
    insertedDocIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Portfolio A');
    const tenantB = await db.createTenantWithUser('Empresa Portfolio B (sem vencimento)');
    const tenantC = await db.createTenantWithUser('Empresa Portfolio C (nao vinculada)');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantCId = tenantC.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Carteira');
    technicianUserId = tech.userId;

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianUserId],
    );
    technicianId = techResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2)',
      [tenantAId, technicianId, tenantBId],
    );
    // tenantC fica sem vínculo — deve ficar de fora da carteira do técnico.

    await insertDocument(tenantAId, tenantA.userId, 'pgr', 'PGR Vencido A', isoDateDaysFromNow(-5));
    await insertDocument(tenantAId, tenantA.userId, 'laudo', 'Laudo Em Dia A', isoDateDaysFromNow(90));
    await insertDocument(tenantCId, tenantC.userId, 'pgr', 'PGR C (não deve aparecer)', isoDateDaysFromNow(-1));

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    if (insertedDocIds.length > 0) {
      await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [insertedDocIds]);
    }
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /documents/compliance/portfolio devolve uma linha por empresa vinculada, com score e contagens corretos', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const byId: Record<string, any> = Object.fromEntries(res.body.map((item: any) => [item.tenant_id, item]));

    expect(byId[tenantAId].score).toBe(50);
    expect(byId[tenantAId].pendencias_count).toBe(1);
    expect(byId[tenantAId].avisos_count).toBe(0);

    expect(byId[tenantBId].score).toBeNull();
    expect(byId[tenantBId].pendencias_count).toBe(0);
    expect(byId[tenantBId].avisos_count).toBe(0);

    expect(byId[tenantCId]).toBeUndefined();
  });

  it('GET /documents/compliance/portfolio nega acesso a quem não é técnico', async () => {
    const empresa = await db.createTenantWithUser('Empresa Portfolio Negada');
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: empresa.email, password: empresa.password });

    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${empresaLogin.body.access_token}`);

    expect(res.status).toBe(403);
  });

  it('GET /documents sem tenant_id, para técnico, devolve os documentos de toda a carteira via RLS', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((doc: any) => doc.id);
    expect(ids).toContain(insertedDocIds[0]); // PGR Vencido A
    expect(ids).toContain(insertedDocIds[1]); // Laudo Em Dia A
    expect(ids).not.toContain(insertedDocIds[2]); // PGR C — não vinculada
  });
});
