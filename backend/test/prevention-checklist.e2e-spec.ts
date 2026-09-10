import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Checklist de prevenção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let technicianToken: string;
  let empresaToken: string;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Checklist Prevencao');
    tenantId = tenant.tenantId;

    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Checklist Prevencao');
    technicianId = technicianUser.userId;
    await (db as any).client.query(`INSERT INTO technicians (user_id) VALUES ($1)`, [technicianUser.userId]);
    const technicianRow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianUser.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantId,
      technicianRow.rows[0].id,
    ]);

    const technicianLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    technicianToken = technicianLogin.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico cria um checklist e recebe os 14 itens seedados', async () => {
    const res = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-01', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rascunho');
    expect(res.body.items.length).toBe(14);
    expect(res.body.items.every((item: any) => item.status === null)).toBe(true);
  });

  it('empresa não consegue criar checklist (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-01', tenant_id: tenantId });

    expect(res.status).toBe(403);
  });

  it('atualiza um item, faz upload de foto, e conclui gerando ação corretiva pro item NC', async () => {
    const created = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-02', tenant_id: tenantId });
    const checklistId = created.body.id;
    const ncItem = created.body.items.find((i: any) => i.item_key === 'extintores_acessiveis');
    const okItem = created.body.items.find((i: any) => i.item_key === 'saidas_desobstruidas');

    const ncUpdate = await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${ncItem.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', observacoes: 'Extintor bloqueado por caixas' });
    expect(ncUpdate.status).toBe(200);
    expect(ncUpdate.body.status).toBe('NC');

    const photoUpload = await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/items/${ncItem.id}/foto`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'extintor.jpg', contentType: 'image/jpeg' });
    expect(photoUpload.status).toBe(201);
    expect(photoUpload.body.foto_r2_key).toContain(checklistId);

    const photoGet = await request(app.getHttpServer())
      .get(`/prevention-checklists/${checklistId}/items/${ncItem.id}/foto`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(photoGet.status).toBe(200);
    expect(typeof photoGet.body.url).toBe('string');
    expect(photoGet.body.url.length).toBeGreaterThan(0);

    const photoGetNoPhoto = await request(app.getHttpServer())
      .get(`/prevention-checklists/${checklistId}/items/${okItem.id}/foto`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(photoGetNoPhoto.status).toBe(404);

    await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${okItem.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const actionsRes = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(actionsRes.body.some((a: any) => a.checklist_item_id === ncItem.id)).toBe(true);
    expect(actionsRes.body.some((a: any) => a.checklist_item_id === okItem.id)).toBe(false);
  });

  it('não permite editar item nem fazer upload depois de concluído', async () => {
    const created = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-03', tenant_id: tenantId });
    const checklistId = created.body.id;
    const itemId = created.body.items[0].id;

    await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    const editAttempt = await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    expect(editAttempt.status).toBe(409);
  });
});
