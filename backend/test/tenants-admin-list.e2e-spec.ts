import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenants (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tenantAId: string;
  let tenantBId: string;
  let tenantCId: string;
  let technician1Id: string;
  let technician2Id: string;
  let partnerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Admin List A');
    const tenantB = await db.createTenantWithUser('Empresa Admin List B');
    const tenantC = await db.createTenantWithUser('Empresa Admin List C');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantCId = tenantC.tenantId;

    const admin = await db.createUserWithRole('admin', 'Admin List Teste');
    const tech1 = await db.createUserWithRole('tecnico', 'Tecnico List Um');
    const tech2 = await db.createUserWithRole('tecnico', 'Tecnico List Dois');
    const partner1 = await db.createUserWithRole('parceiro', 'Parceiro List Um');

    const tech1Result = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech1.userId],
    );
    technician1Id = tech1Result.rows[0].id;

    const tech2Result = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech2.userId],
    );
    technician2Id = tech2Result.rows[0].id;

    const partnerResult = await (db as any).client.query(
      'INSERT INTO partners (user_id, service_region) VALUES ($1, $2) RETURNING id',
      [partner1.userId, 'Sul'],
    );
    partnerId = partnerResult.rows[0].id;

    // tenantB: 1 técnico vinculado, 0 parceiros
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantBId, technician1Id],
    );

    // tenantC: 2 técnicos + 1 parceiro vinculados
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantCId, technician1Id],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantCId, technician2Id],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantCId, partnerId],
    );

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantBId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantCId]);
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantCId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technician1Id]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technician2Id]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin vê todos os tenants com vínculos agregados corretamente', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((t: any) => [t.id, t]));

    const tenantA = byId.get(tenantAId) as any;
    expect(tenantA.technicians).toEqual([]);
    expect(tenantA.partners).toEqual([]);

    const tenantB = byId.get(tenantBId) as any;
    expect(tenantB.technicians).toHaveLength(1);
    expect(tenantB.technicians[0].id).toBe(technician1Id);
    expect(tenantB.partners).toEqual([]);

    const tenantC = byId.get(tenantCId) as any;
    expect(tenantC.technicians).toHaveLength(2);
    expect(tenantC.technicians.map((t: any) => t.id).sort()).toEqual(
      [technician1Id, technician2Id].sort(),
    );
    expect(tenantC.partners).toHaveLength(1);
    expect(tenantC.partners[0].id).toBe(partnerId);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia tecnico com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Bloqueio List');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia parceiro com 403', async () => {
    const parceiro = await db.createUserWithRole('parceiro', 'Parceiro Bloqueio List');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: parceiro.email, password: parceiro.password });
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
