import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET/PATCH /tenants/me (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Onboarding');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_units WHERE tenant_id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('retorna o próprio tenant com sector/contact ainda vazios', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(tenantId);
    expect(res.body.sector).toBeNull();
  });

  it('atualiza sector/contact_name/contact_phone', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ sector: 'Indústria', contact_name: 'Ana RH', contact_phone: '48999990000' });

    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('Indústria');
    expect(res.body.contact_name).toBe('Ana RH');
    expect(res.body.contact_phone).toBe('48999990000');
  });

  it('rejeita campos fora da allowlist (ex: tentar mudar plan/cnpj)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise', cnpj: '00000000000000' });

    // forbidNonWhitelisted: true rejeita a requisição inteira (400) —
    // não existe um "ignora silenciosamente e aplica o resto".
    expect(res.status).toBe(400);
  });

  it('salva nome fantasia e cargo do contato', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ trade_name: 'Diogo Construção', contact_role: 'Sócio-administrador' });

    expect(res.status).toBe(200);
    expect(res.body.trade_name).toBe('Diogo Construção');
    expect(res.body.contact_role).toBe('Sócio-administrador');
  });

  it('endereço parcial da matriz não cria company_unit ainda', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address_street: 'Rua Francisco Mattos Terres', address_number: '01' });

    expect(res.status).toBe(200);

    const units = await (db as any).client.query(
      'SELECT * FROM company_units WHERE tenant_id = $1 AND is_matriz = true',
      [tenantId],
    );
    expect(units.rows).toHaveLength(0);
  });

  it('endereço completo da matriz cria a company_unit marcada is_matriz, e uma segunda gravação atualiza a mesma linha', async () => {
    const res1 = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address_city: 'Porto Alegre', address_state: 'RS', address_zip: '90000000' });

    expect(res1.status).toBe(200);

    const unitsAfterFirst = await (db as any).client.query(
      'SELECT * FROM company_units WHERE tenant_id = $1 AND is_matriz = true',
      [tenantId],
    );
    expect(unitsAfterFirst.rows).toHaveLength(1);
    expect(unitsAfterFirst.rows[0].name).toBe('Matriz');
    expect(unitsAfterFirst.rows[0].address_street).toBe('Rua Francisco Mattos Terres');
    expect(unitsAfterFirst.rows[0].address_city).toBe('Porto Alegre');
    const matrizUnitId = unitsAfterFirst.rows[0].id;

    // Atualiza o endereço de novo — não pode criar uma segunda matriz.
    const res2 = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address_number: '02' });

    expect(res2.status).toBe(200);

    const unitsAfterSecond = await (db as any).client.query(
      'SELECT * FROM company_units WHERE tenant_id = $1 AND is_matriz = true',
      [tenantId],
    );
    expect(unitsAfterSecond.rows).toHaveLength(1);
    expect(unitsAfterSecond.rows[0].id).toBe(matrizUnitId);
    expect(unitsAfterSecond.rows[0].address_number).toBe('02');
  });

  it('bloqueia role sem permissão (tecnico) com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Onboarding');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(403);
  });
});
