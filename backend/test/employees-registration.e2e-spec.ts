import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

describe('Matrícula e setor do funcionário (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let srv: any;
  let token: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Employees Matricula Teste');
    const login = await request(srv).post('/auth/login').send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria e edita funcionário com matrícula e setor', async () => {
    const c = await request(srv).post('/employees').set(auth()).send({
      full_name: 'Func Matrícula', cpf: '39053344705', registration_number: 'M-0042', department: 'Manutenção',
    });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ registration_number: 'M-0042', department: 'Manutenção' });
    const u = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send({ department: 'Produção' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ registration_number: 'M-0042', department: 'Produção' });
  });

  it('campos antigos continuam funcionando junto com os novos', async () => {
    const c = await request(srv).post('/employees').set(auth()).send({
      full_name: 'Func Antigo', cpf: '11144477735', position: 'Soldador', birth_date: '1990-05-01',
      admission_date: '2020-01-10',
    });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ position: 'Soldador', registration_number: null, department: null });
    const u = await request(srv).patch(`/employees/${c.body.id}`).set(auth())
      .send({ full_name: 'Func Antigo Editado', position: 'Caldeireiro', registration_number: 'M-7' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ full_name: 'Func Antigo Editado', position: 'Caldeireiro', registration_number: 'M-7' });
  });

  it('rejeita matrícula/setor longos ou com NUL (400, nunca 500)', async () => {
    const base = { full_name: 'Func Inválido', cpf: '52998224725' };
    for (const bad of [{ registration_number: 'x'.repeat(31) }, { department: 'y'.repeat(121) }, { department: 'a\u0000b' }, { registration_number: 123 }]) {
      const r = await request(srv).post('/employees').set(auth()).send({ ...base, ...bad });
      expect(r.status).toBe(400);
    }
  });

  it('PATCH também rejeita valores inválidos com 400', async () => {
    const c = await request(srv).post('/employees').set(auth()).send({ full_name: 'Func Patch', cpf: '16899535009' });
    expect(c.status).toBe(201);
    for (const bad of [{ registration_number: 'x'.repeat(31) }, { department: 'a\u0000b' }, { department: 5 }]) {
      const r = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send(bad);
      expect(r.status).toBe(400);
    }
  });

  it('aceita matrícula de exatamente 30 caracteres', async () => {
    const r = await request(srv).post('/employees').set(auth()).send({ full_name: 'Func Trinta', cpf: '12345678909', registration_number: 'x'.repeat(30) });
    expect(r.status).toBe(201);
  });

  it('campo desconhecido no corpo do POST e do PATCH -> 400 (forbidNonWhitelisted)', async () => {
    const p = await request(srv).post('/employees').set(auth()).send({ full_name: 'Func Extra', cpf: '45317828791', campo_extra: 1 });
    expect(p.status).toBe(400);
    const c = await request(srv).post('/employees').set(auth()).send({ full_name: 'Func Extra2', cpf: '98765432100' });
    expect(c.status).toBe(201);
    const u = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send({ campo_extra: 1 });
    expect(u.status).toBe(400);
  });

  it('empresa com tenant_id de outro tenant no corpo: nunca cria no tenant do corpo', async () => {
    const other = await db.createTenantWithUser('Empresa Employees Matricula Outra');
    const r = await request(srv).post('/employees').set(auth()).send({ full_name: 'Func Cross', cpf: '71428793860', tenant_id: other.tenantId });
    expect(r.status).toBe(201);
    expect(r.body.tenant_id).not.toBe(other.tenantId);
    const q = await (db as any).client.query('SELECT 1 FROM employees WHERE tenant_id = $1 AND cpf = $2', [other.tenantId, '71428793860']);
    expect(q.rowCount).toBe(0);
  });

  describe('validação real dos DTOs (nunca 500)', () => {
    const post = (b: Record<string, unknown>) => request(srv).post('/employees').set(auth()).send(b);

    it('CPF com máscara é aceito e gravado só com dígitos', async () => {
      const r = await post({ full_name: 'Func Máscara', cpf: '529.982.247-25' });
      expect(r.status).toBe(201);
      expect(r.body.cpf).toBe('52998224725');
    });

    it('CPF repetido na mesma empresa -> 409 com mensagem sem texto do pg', async () => {
      expect((await post({ full_name: 'Func Dup 1', cpf: '10000000001' })).status).toBe(201);
      const r = await post({ full_name: 'Func Dup 2', cpf: '100.000.000-01' });
      expect(r.status).toBe(409);
      expect(r.body.message).toBe('CPF já cadastrado nesta empresa');
      const p = await post({ full_name: 'Func Dup 3', cpf: '10000000003' });
      const u = await request(srv).patch(`/employees/${p.body.id}`).set(auth()).send({ cpf: '10000000001' });
      expect(u.status).toBe(409);
    });

    it('CPF inválido (abc, 12 dígitos), data inexistente, status e UUID inválidos, nome ausente -> 400', async () => {
      expect((await post({ full_name: 'X', cpf: 'abc' })).status).toBe(400);
      expect((await post({ full_name: 'X', cpf: '123456789012' })).status).toBe(400);
      expect((await post({ full_name: 'X', cpf: '10000000010', birth_date: '2026-02-30' })).status).toBe(400);
      expect((await post({ full_name: 'X', cpf: '10000000011', admission_date: '2026-13-01' })).status).toBe(400);
      expect((await post({ full_name: 'X', cpf: '10000000012', company_unit_id: 'abc' })).status).toBe(400);
      expect((await post({ cpf: '10000000013' })).status).toBe(400);
      expect((await post({ full_name: null, cpf: '10000000014' })).status).toBe(400);
      expect((await post({ full_name: { a: 1 }, cpf: '10000000015' })).status).toBe(400);
      expect((await post({ full_name: 'X' })).status).toBe(400);
      const c = await post({ full_name: 'Func Patch Inv', cpf: '10000000016' });
      for (const bad of [{ status: 'xyz' }, { birth_date: '2026-02-30' }, { company_unit_id: 'abc' }, { position_id: 'abc' }, { cpf: 'abc' }, { full_name: null }, { cpf: null }, { status: null }, { full_name: '' }]) {
        expect([JSON.stringify(bad), (await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send(bad)).status]).toEqual([JSON.stringify(bad), 400]);
      }
    });

    it('PATCH com null limpa department/position/matrícula (200); matrícula só com espaços vira null', async () => {
      const c = await post({ full_name: 'Func Limpa', cpf: '10000000020', position: 'Soldador', department: 'Prod', registration_number: 'M-1' });
      expect(c.status).toBe(201);
      const u = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send({ department: null, position: null, registration_number: '  ' });
      expect(u.status).toBe(200);
      expect(u.body).toMatchObject({ department: null, position: null, registration_number: null });
      const v = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send({ status: 'inativo', birth_date: '1990-01-31', company_unit_id: '' });
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({ status: 'inativo', birth_date: expect.stringContaining('1990-01-31') });
    });

    it('envio do onboarding (full_name, cpf mascarado, position, company_unit_id vazio) continua funcionando', async () => {
      const r = await post({ full_name: 'Func Onboarding', cpf: '100.000.000-30', position: 'Auxiliar', company_unit_id: '' });
      expect(r.status).toBe(201);
      expect(r.body.company_unit_id).toBeNull();
    });

    it('admin com tenant_id inválido no corpo -> 400', async () => {
      const adm = await db.createUserWithRole('admin', 'Admin Employees Dto');
      const t = (await request(srv).post('/auth/login').send({ email: adm.email, password: adm.password })).body.access_token;
      const r = await request(srv).post('/employees').set({ Authorization: `Bearer ${t}` }).send({ full_name: 'X', cpf: '10000000040', tenant_id: 'abc' });
      expect(r.status).toBe(400);
    });
  });
});
