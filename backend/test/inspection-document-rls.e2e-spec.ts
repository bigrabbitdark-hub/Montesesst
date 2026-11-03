import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Etapa 1 do Relatório de Visita Técnica: isolamento entre
// tenants em /inspections/:id (documentos_anexos) e /documents/:id/
// download. Cobre tanto a checagem no service (defense in depth)
// quanto a RLS do banco (multi-tenancy real).
describe('Isolamento multi-tenant de anexos de inspeção (Etapa 1, e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let inspectionAId: string;
  let inspectionBId: string;
  let companyUnitAId: string;
  let docAId: string;
  let docBId: string;
  let empresaAToken: string;
  let empresaBToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa A Inspection RLS Doc');
    const tenantB = await db.createTenantWithUser('Empresa B Inspection RLS Doc');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico RLS Doc');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      `INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2)`,
      [tenantAId, technicianId, tenantBId],
    );

    const unitAResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz A', 'Rua A', 'Cidade A', 'SP', '01000000') RETURNING id`,
      [tenantAId],
    );
    companyUnitAId = unitAResult.rows[0].id;

    const unitBResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz B', 'Rua B', 'Cidade B', 'SP', '01000000') RETURNING id`,
      [tenantBId],
    );
    const companyUnitBId = unitBResult.rows[0].id;

    // Cria uma inspeção em cada tenant via service (sem passar por
    // HTTP pra simplificar — o setup do POST /inspections já está
    // coberto em inspections-create-list.e2e-spec.ts).
    const createResA = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${(await request(app.getHttpServer()).post('/auth/login').send({ email: tech.email, password: tech.password })).body.access_token}`)
      .send({ tenant_id: tenantAId, visited_at: '2026-09-15', company_unit_id: companyUnitAId });
    inspectionAId = createResA.body.id;

    const techToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: tech.email, password: tech.password })).body.access_token;
    const createResB = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ tenant_id: tenantBId, visited_at: '2026-09-15', company_unit_id: companyUnitBId });
    inspectionBId = createResB.body.id;

    // Faz login dos usuários empresa.
    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    empresaAToken = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    empresaBToken = loginB.body.access_token;

    // Anexa um PDF em cada inspeção.
    const docARes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Relatório A')
      .field('inspection_id', inspectionAId)
      .attach('file', Buffer.from('%PDF-1.4 doc A'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      });
    docAId = docARes.body.id;

    const docBRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaBToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Relatório B')
      .field('inspection_id', inspectionBId)
      .attach('file', Buffer.from('%PDF-1.4 doc B'), {
        filename: 'b.pdf',
        contentType: 'application/pdf',
      });
    docBId = docBRes.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[docAId, docBId]]);
    await (db as any).client.query('DELETE FROM inspections WHERE id = ANY($1)', [[inspectionAId, inspectionBId]]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /inspections/:id retorna apenas os documentos_anexos da inspeção A para empresa A', async () => {
    const res = await request(app.getHttpServer())
      .get(`/inspections/${inspectionAId}`)
      .set('Authorization', `Bearer ${empresaAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.documentos_anexos).toHaveLength(1);
    expect(res.body.documentos_anexos[0].id).toBe(docAId);
    expect(res.body.documentos_anexos[0].title).toBe('Relatório A');
  });

  it('GET /inspections/:id da inspeção A: empresa B não vê a inspeção (RLS em inspections)', async () => {
    // A RLS em inspections filtra a inspeção de A para o tenant B,
    // então a rota retorna 404 (findOne não encontra a inspeção).
    const res = await request(app.getHttpServer())
      .get(`/inspections/${inspectionAId}`)
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(404);
  });

  it('empresa A não consegue baixar documento da empresa B (404 — RLS em documents)', async () => {
    // A RLS em documents filtra a linha do doc B para o tenant A,
    // então a rota retorna 404 (findOne não encontra o documento).
    const res = await request(app.getHttpServer())
      .get(`/documents/${docBId}/download`)
      .set('Authorization', `Bearer ${empresaAToken}`);

    expect(res.status).toBe(404);
  });

  it('empresa B não consegue baixar documento da empresa A (404 — RLS em documents)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/documents/${docAId}/download`)
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(404);
  });

  it('GET /inspections (findAll) inclui documentos_count por inspeção, isolado por tenant', async () => {
    // A lista da empresa A tem a inspeção A com 1 doc; a inspeção B
    // nem aparece (RLS em inspections).
    const resA = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${empresaAToken}`);

    expect(resA.status).toBe(200);
    const inspA = resA.body.find((i: { id: string }) => i.id === inspectionAId);
    expect(inspA).toBeDefined();
    expect(inspA.documentos_count).toBe(1);
    expect(resA.body.find((i: { id: string }) => i.id === inspectionBId)).toBeUndefined();

    // Lista da empresa B: vê a inspeção B com 1 doc, não vê A.
    const resB = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(resB.status).toBe(200);
    const inspB = resB.body.find((i: { id: string }) => i.id === inspectionBId);
    expect(inspB).toBeDefined();
    expect(inspB.documentos_count).toBe(1);
    expect(resB.body.find((i: { id: string }) => i.id === inspectionAId)).toBeUndefined();
  });
});
