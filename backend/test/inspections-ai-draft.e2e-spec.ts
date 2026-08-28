import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FIELD_REPORT_EXTRACTOR } from '../src/ai-copilot/field-report-extractor.interface';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/ai-draft (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  const fakeExtractor = { extract: jest.fn() };

  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let inspectionId: string;

  let otherTenantId: string;
  let otherTechnicianId: string;
  let otherTechnicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIELD_REPORT_EXTRACTOR)
      .useValue(fakeExtractor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa AI Draft Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico AI Draft Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-27' });
    inspectionId = createRes.body.id;

    const otherTenant = await db.createTenantWithUser('Empresa AI Draft Nao Vinculada Teste');
    otherTenantId = otherTenant.tenantId;
    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico AI Draft Nao Vinculado Teste');
    const otherTechResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [otherTech.userId],
    );
    otherTechnicianId = otherTechResult.rows[0].id;
    const loginOtherTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherTech.email, password: otherTech.password });
    otherTechnicianToken = loginOtherTech.body.access_token;
  });

  afterEach(() => {
    fakeExtractor.extract.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianId, otherTechnicianId],
    ]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico vinculado recebe a sugestão devolvida pelo extractor', async () => {
    fakeExtractor.extract.mockResolvedValue([
      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido' },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: 'Extintor com lacre rompido.' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([{ item_key: 'extintores', status: 'NC', notes: 'Lacre rompido' }]);
    expect(fakeExtractor.extract).toHaveBeenCalledWith('Extintor com lacre rompido.');
  });

  it('rejeita report_text vazio com 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: '' });

    expect(res.status).toBe(400);
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });

  it('rejeita report_text acima de 5000 caracteres com 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: 'a'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ report_text: 'relato qualquer' });

    expect(res.status).toBe(403);
  });

  it('técnico sem vínculo com a inspeção recebe 404 (RLS)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${otherTechnicianToken}`)
      .send({ report_text: 'relato qualquer' });

    expect(res.status).toBe(404);
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });
});
