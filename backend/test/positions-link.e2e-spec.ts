import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /positions/link-suggestions e POST /positions/confirm-links (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let positionBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Vinculo Cargo A');
    const tenantB = await db.createTenantWithUser('Empresa Vinculo Cargo B');
    tenantAId = tenantA.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    // 3 funcionários com grafias diferentes do "mesmo" cargo (normalização
    // colapsa acento/case/espaço, mas não sinônimo/abreviação — 2 grupos
    // esperados, não 1).
    await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, position, status) VALUES
       ($1, 'Ana', '10000000001', 'Auxiliar Administrativo', 'ativo'),
       ($1, 'Bia', '10000000002', 'auxiliar administrativo', 'ativo'),
       ($1, 'Caio', '10000000003', 'Soldador', 'ativo')`,
      [tenantAId],
    );

    const positionB = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Cargo do Tenant B' });
    positionBId = positionB.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('agrupa funcionários por texto normalizado, ignora quem já tem cpf de outro tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/positions/link-suggestions')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const auxGroup = res.body.find((g: any) => g.employee_count === 2);
    expect(auxGroup.suggested_name).toBe('Auxiliar Administrativo');
    expect(auxGroup.employee_ids).toHaveLength(2);

    const soldadorGroup = res.body.find((g: any) => g.employee_count === 1);
    expect(soldadorGroup.suggested_name).toBe('Soldador');
  });

  it('confirma os grupos: cria cargo (ou reaproveita) e vincula os funcionários', async () => {
    const suggestions = await request(app.getHttpServer())
      .get('/positions/link-suggestions')
      .set('Authorization', `Bearer ${tokenA}`);

    const confirmRes = await request(app.getHttpServer())
      .post('/positions/confirm-links')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ groups: suggestions.body });

    expect(confirmRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${tokenA}`);

    const auxCargo = listRes.body.find((p: any) => p.name === 'Auxiliar Administrativo');
    expect(auxCargo.employee_count).toBe(2);

    // Confirmação repetida (idempotente) não duplica o cargo.
    const secondConfirm = await request(app.getHttpServer())
      .post('/positions/confirm-links')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ groups: [{ suggested_name: 'Auxiliar Administrativo', employee_ids: suggestions.body[0].employee_ids }] });
    expect(secondConfirm.status).toBe(201);

    const listAfter = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listAfter.body.filter((p: any) => p.name === 'Auxiliar Administrativo')).toHaveLength(1);
  });

  it('rejeita vincular funcionário via position_id de outro tenant no PATCH /employees/:id', async () => {
    const employeesA = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${tokenA}`);
    const employeeId = employeesA.body.find((e: any) => e.full_name === 'Caio').id;

    const res = await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ position_id: positionBId });

    expect(res.status).toBe(400);
  });

  it('rejeita confirm-links vinculando employee_ids de outro tenant a um cargo do tenant chamador', async () => {
    const employeesB = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${tokenB}`);
    const foreignEmployeeId = employeesB.body[0].id;

    await request(app.getHttpServer())
      .post('/positions/confirm-links')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ groups: [{ suggested_name: 'Cargo Cross Tenant', employee_ids: [foreignEmployeeId] }] });

    const employeesBAfter = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${tokenB}`);
    const stillOwn = employeesBAfter.body.find((e: any) => e.id === foreignEmployeeId);
    expect(stillOwn.position_id ?? null).toBeNull();
  });
});
