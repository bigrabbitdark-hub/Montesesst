import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /technicians e GET /partners incluem full_name/email (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let technicianId: string;
  let partnerId: string;
  let techEmail: string;
  let partnerEmail: string;

  const techFullName = 'Tecnico Fields Teste';
  const partnerFullName = 'Parceiro Fields Teste';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Fields Teste');
    const tech = await db.createUserWithRole('tecnico', techFullName);
    const partner = await db.createUserWithRole('parceiro', partnerFullName);
    techEmail = tech.email;
    partnerEmail = partner.email;

    const techResult = await (db as any).client.query(
      `INSERT INTO technicians (user_id, registration_number, specialization)
       VALUES ($1, $2, $3) RETURNING id`,
      [tech.userId, 'REG-001', 'Segurança do Trabalho'],
    );
    technicianId = techResult.rows[0].id;

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, $2) RETURNING id`,
      [partner.userId, 'Sul'],
    );
    partnerId = partnerResult.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /technicians inclui full_name/email sem perder os campos existentes', async () => {
    const res = await request(app.getHttpServer())
      .get('/technicians')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((t: any) => t.id === technicianId);
    expect(found).toBeDefined();
    expect(found.full_name).toBe(techFullName);
    expect(found.email).toBe(techEmail);
    expect(found.registration_number).toBe('REG-001');
    expect(found.specialization).toBe('Segurança do Trabalho');
    expect(found.status).toBe('ativo');
  });

  it('GET /technicians/:id inclui full_name/email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe(techFullName);
    expect(res.body.email).toBe(techEmail);
  });

  it('GET /partners inclui full_name/email sem perder os campos existentes', async () => {
    const res = await request(app.getHttpServer())
      .get('/partners')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((p: any) => p.id === partnerId);
    expect(found).toBeDefined();
    expect(found.full_name).toBe(partnerFullName);
    expect(found.email).toBe(partnerEmail);
    expect(found.service_region).toBe('Sul');
    expect(found.status).toBe('ativo');
  });

  it('GET /partners/:id inclui full_name/email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${partnerId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe(partnerFullName);
    expect(res.body.email).toBe(partnerEmail);
  });
});
