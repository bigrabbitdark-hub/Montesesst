import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /audit-log (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let createdTechnicianId: string;
  let markerEmail: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Audit Teste');
    const admin = await db.createUserWithRole('admin', 'Admin Audit Teste');

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    // Gera uma entrada real de auditoria: POST /technicians é admin-only e
    // mutante, então o AuditInterceptor grava um evento 'create'/'technicians'
    // de verdade — não inserimos direto na tabela, deixamos o interceptor
    // gravar como aconteceria em produção.
    markerEmail = `tecnico-audit-marker-${Date.now()}@teste.montese.local`;
    const createRes = await request(app.getHttpServer())
      .post('/technicians')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: markerEmail, password: 'senha-teste-123', full_name: 'Tecnico Audit Marker' });
    createdTechnicianId = createRes.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [createdTechnicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin vê o evento de auditoria gerado pelo POST /technicians', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit-log?resource_type=technicians')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const marker = res.body.find((row: any) => row.resource_id === createdTechnicianId);
    expect(marker).toBeDefined();
    expect(marker.action).toBe('create');
    expect(marker.resource_type).toBe('technicians');
    expect(marker.status_code).toBe(201);
    expect(marker.actor_full_name).toBe('Admin Audit Teste');
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit-log')
      .set('Authorization', `Bearer ${tokenEmpresa}`);

    expect(res.status).toBe(403);
  });

  it('respeita limit e offset', async () => {
    const firstPage = await request(app.getHttpServer())
      .get('/audit-log?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const secondPage = await request(app.getHttpServer())
      .get('/audit-log?limit=1&offset=1')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toHaveLength(1);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body).toHaveLength(1);
    expect(firstPage.body[0].id).not.toBe(secondPage.body[0].id);
  });

  it('filtra por resource_type sem retornar eventos de outro tipo', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit-log?resource_type=technicians&limit=200')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(row.resource_type).toBe('technicians');
    }
  });
});
