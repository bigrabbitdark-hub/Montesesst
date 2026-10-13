import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

// Mesmo app de produção: configureApp registra o ValidationPipe global
// (transform + whitelist + forbidNonWhitelisted). Os demais e2e de employees não o usam.
describe('Funcionários com o ValidationPipe real de produção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;
  let adminToken: string;
  let tenantId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const log = (label: string, res: request.Response) =>
    // eslint-disable-next-line no-console
    console.log(`PIPE ${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    const t = await db.createTenantWithUser('Empresa Pipe Prod');
    tenantId = t.tenantId;
    const admin = await db.createUserWithRole('admin', 'Admin Pipe Prod');
    const l1 = await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password });
    empresaToken = l1.body.access_token;
    const l2 = await request(app.getHttpServer()).post('/auth/login').send({ email: admin.email, password: admin.password });
    adminToken = l2.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const full = (cpf: string) => ({
    full_name: 'Pipe Completo',
    cpf,
    birth_date: '1990-03-05',
    position: 'Soldador',
    admission_date: '2020-01-15',
    sex: 'f',
    cbo_code: '51210',
    esocial_registration: 'PIPE-1',
    activity_description: 'Solda em campo',
  });

  let empId: string;
  let empId2: string;

  it('campo ANTIGO apenas (full_name+cpf) via pipe real', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set(auth(empresaToken))
      .send({ full_name: 'Pipe Antigo', cpf: '11144477735' });
    log('POST antigo', res);
    expect(res.status).toBe(201);
  });

  it('POST /employees com todos os campos oficiais (empresa)', async () => {
    const res = await request(app.getHttpServer()).post('/employees').set(auth(empresaToken)).send(full('52998224725'));
    log('POST completo empresa', res);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sex: 'F', cbo_code: '051210', esocial_registration: 'PIPE-1', activity_description: 'Solda em campo' });
    empId = res.body.id;
  });

  it('POST /employees com todos os campos oficiais (admin, com tenant_id)', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set(auth(adminToken))
      .send({ ...full('12345678909'), esocial_registration: 'PIPE-2', tenant_id: tenantId });
    log('POST completo admin', res);
    expect(res.status).toBe(201);
    expect(res.body.sex).toBe('F');
    empId2 = res.body.id;
  });

  it('PATCH /employees/:id com campo novo (empresa e admin)', async () => {
    const a = await request(app.getHttpServer()).patch(`/employees/${empId}`).set(auth(empresaToken)).send({ cbo_code: '715615' });
    log('PATCH :id empresa', a);
    expect(a.status).toBe(200);
    expect(a.body.cbo_code).toBe('715615');
    const b = await request(app.getHttpServer()).patch(`/employees/${empId}`).set(auth(adminToken)).send({ sex: 'm' });
    log('PATCH :id admin', b);
    expect(b.status).toBe(200);
    expect(b.body.sex).toBe('M');
  });

  it('GET /employees/table (empresa e admin)', async () => {
    const a = await request(app.getHttpServer()).get('/employees/table').set(auth(empresaToken));
    log('GET table empresa', a);
    expect(a.status).toBe(200);
    const b = await request(app.getHttpServer()).get(`/employees/table?tenant_id=${tenantId}`).set(auth(adminToken));
    log('GET table admin', b);
    expect(b.status).toBe(200);
    expect(b.body.total).toBeGreaterThanOrEqual(3);
  });

  const rv = async (id: string) =>
    (await request(app.getHttpServer()).get('/employees/table?limit=200').set(auth(empresaToken))).body.items.find(
      (r: any) => r.id === id,
    ).row_version as string;

  it('PATCH /employees/bulk feliz com 2 mudanças (empresa)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/employees/bulk')
      .set(auth(empresaToken))
      .send({
        changes: [
          { id: empId, row_version: await rv(empId), fields: { position: 'Eletricista', cbo_code: '51210' } },
          { id: empId2, row_version: await rv(empId2), fields: { activity_description: 'Nova' } },
        ],
      });
    log('bulk feliz', res);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const row = res.body.items.find((r: any) => r.id === empId);
    expect(row).toMatchObject({ position: 'Eletricista', cbo_code: '051210' });
  });

  it('bulk: tenant_id dentro de fields é aceito pelo pipe e ignorado', async () => {
    const res = await request(app.getHttpServer())
      .patch('/employees/bulk')
      .set(auth(empresaToken))
      .send({
        changes: [
          { id: empId, row_version: await rv(empId), fields: { tenant_id: '00000000-0000-4000-8000-000000000009', position: 'Mantido' } },
        ],
      });
    log('bulk fields.tenant_id', res);
    expect(res.status).toBe(200);
    expect(res.body.items[0].position).toBe('Mantido');
    const chk = await (db as any).client.query('SELECT tenant_id FROM employees WHERE id = $1', [empId]);
    expect(chk.rows[0].tenant_id).toBe(tenantId);
  });

  it('bulk: chave extra no corpo e changes ausente dão 400', async () => {
    const extra = await request(app.getHttpServer())
      .patch('/employees/bulk')
      .set(auth(empresaToken))
      .send({ changes: [{ id: empId, row_version: await rv(empId), fields: { position: 'X' } }], foo: 1 });
    log('bulk foo', extra);
    expect(extra.status).toBe(400);
    const missing = await request(app.getHttpServer()).patch('/employees/bulk').set(auth(empresaToken)).send({});
    log('bulk sem changes', missing);
    expect(missing.status).toBe(400);
  });
});
