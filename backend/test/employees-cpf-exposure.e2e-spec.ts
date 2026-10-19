import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

// Onda de segurança (2026-10-19): tabela oficial só para empresa/admin; técnico e parceiro recebem CPF mascarado
// em GET /employees e GET /employees/:id; campos oficiais não aceitam objeto/array; importação exige dígito verificador.
const MASKED = /^\*\*\*\.\d{3}\.\d{3}-\*\*$/;

describe('Funcionários: exposição de CPF por papel e validação de tipos (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let srv: any;
  let tokenA: string;
  let tokenB: string;
  let tecToken: string;
  let parToken: string;
  let adminToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let empAId: string;
  const CPF_A = '52998224725';

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sql = (q: string, p: unknown[] = []) => (db as any).client.query(q, p);
  const login = async (email: string, password: string) =>
    (await request(srv).post('/auth/login').send({ email, password })).body.access_token as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();

    const a = await db.createTenantWithUser('Empresa Cpf Exposicao A');
    const b = await db.createTenantWithUser('Empresa Cpf Exposicao B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    const admin = await db.createUserWithRole('admin', 'Admin Cpf Exposicao');
    adminToken = await login(admin.email, admin.password);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Cpf Exposicao');
    const tecRow = await sql('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId]);
    await sql('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantAId, tecRow.rows[0].id]);
    tecToken = await login(tec.email, tec.password);
    const par = await db.createUserWithRole('parceiro', 'Parceiro Cpf Exposicao');
    const parRow = await sql(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [par.userId]);
    await sql('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantAId, parRow.rows[0].id]);
    parToken = await login(par.email, par.password);

    const c = await request(srv).post('/employees').set(auth(tokenA)).send({ full_name: 'Cpf Exposto A', cpf: CPF_A });
    expect(c.status).toBe(201);
    empAId = c.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  describe('B1: GET /employees/table', () => {
    it('técnico e parceiro vinculados recebem 403', async () => {
      for (const t of [tecToken, parToken]) {
        const r = await request(srv).get(`/employees/table?tenant_id=${tenantAId}`).set(auth(t));
        expect(r.status).toBe(403);
      }
    });

    it('empresa A vê só o próprio tenant (mesmo pedindo o tenant B) e admin lê qualquer tenant', async () => {
      const own = await request(srv).get('/employees/table?limit=200').set(auth(tokenA));
      expect(own.status).toBe(200);
      expect(own.body.items.some((r: any) => r.id === empAId)).toBe(true);
      const cross = await request(srv).get(`/employees/table?tenant_id=${tenantBId}&limit=200`).set(auth(tokenA));
      expect(cross.status).toBe(200);
      expect(cross.body.total).toBe(0);
      const fromB = await request(srv).get('/employees/table?limit=200').set(auth(tokenB));
      expect(fromB.body.items.some((r: any) => r.id === empAId)).toBe(false);
      const adm = await request(srv).get(`/employees/table?tenant_id=${tenantAId}&limit=200`).set(auth(adminToken));
      expect(adm.status).toBe(200);
      expect(adm.body.items.find((r: any) => r.id === empAId)?.cpf).toBe(CPF_A);
    });
  });

  describe('B2: CPF por papel em GET /employees e GET /employees/:id', () => {
    it('empresa e admin veem o CPF completo', async () => {
      const list = await request(srv).get('/employees').set(auth(tokenA));
      expect(list.body.find((e: any) => e.id === empAId)?.cpf).toBe(CPF_A);
      const one = await request(srv).get(`/employees/${empAId}`).set(auth(adminToken));
      expect(one.body.cpf).toBe(CPF_A);
      expect(one.body).toHaveProperty('birth_date');
      expect(one.body).toHaveProperty('created_at');
    });

    it.each([['tecnico'], ['parceiro']])('%s vê o CPF mascarado (lista e detalhe), nunca o completo', async (who) => {
      const t = who === 'tecnico' ? tecToken : parToken;
      const list = await request(srv).get(`/employees?tenant_id=${tenantAId}`).set(auth(t));
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThan(0);
      for (const e of list.body) expect(e.cpf).toMatch(MASKED);
      expect(list.body.find((e: any) => e.id === empAId)?.cpf).toBe('***.982.247-**');
      const one = await request(srv).get(`/employees/${empAId}`).set(auth(t));
      expect(one.status).toBe(200);
      expect(one.body.cpf).toBe('***.982.247-**');
      expect(JSON.stringify(list.body) + JSON.stringify(one.body)).not.toContain(CPF_A);
      // Projeção mínima: nada de nascimento, sexo, CBO, atividade, admissão ou campos do eSocial.
      const KEYS = ['company_unit_id', 'cpf', 'department', 'full_name', 'id', 'position', 'position_id', 'registration_number', 'status', 'tenant_id'];
      expect(Object.keys(one.body).sort()).toEqual(KEYS);
      for (const e of list.body) expect(Object.keys(e).sort()).toEqual(KEYS);
    });
  });

  describe('B3: tipos dos campos oficiais e CPF da importação', () => {
    it('POST/PATCH com objeto/array em sex, cbo_code, activity_description => 400 e nada gravado como "[object Object]"', async () => {
      const bads = [{ sex: { a: 1 } }, { cbo_code: ['051210'] }, { activity_description: { x: 1 } }, { cbo_code: true }, { sex: 'F'.repeat(21) }];
      for (const bad of bads) {
        const r = await request(srv).post('/employees').set(auth(tokenA)).send({ full_name: 'Tipo Ruim', cpf: '11144477735', ...bad });
        expect([JSON.stringify(bad), r.status]).toEqual([JSON.stringify(bad), 400]);
        const u = await request(srv).patch(`/employees/${empAId}`).set(auth(tokenA)).send(bad);
        expect([JSON.stringify(bad), u.status]).toEqual([JSON.stringify(bad), 400]);
      }
      const ok = await request(srv).patch(`/employees/${empAId}`).set(auth(tokenA)).send({ cbo_code: 51210, sex: 'f', activity_description: 'Solda' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ cbo_code: '051210', sex: 'F', activity_description: 'Solda' });
    });

    it('bulk com objeto em position => 400 e o valor não é gravado', async () => {
      const row = (await request(srv).get('/employees/table?limit=200').set(auth(tokenA))).body.items.find((r: any) => r.id === empAId);
      const r = await request(srv)
        .patch('/employees/bulk')
        .set(auth(tokenA))
        .send({ changes: [{ id: empAId, row_version: row.row_version, fields: { position: { a: 1 } } }] });
      expect(r.status).toBe(400);
      const chk = await sql('SELECT position FROM employees WHERE id = $1', [empAId]);
      expect(chk.rows[0].position).not.toBe('[object Object]');
    });

    it('importação CSV: CPF com 11 dígitos mas dígito verificador errado vira erro da linha', async () => {
      const unit = await sql(
        `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
         VALUES ($1, 'Sede Csv', 'Rua X', 'Criciúma', 'SC', '88800000') RETURNING id`,
        [tenantAId],
      );
      expect(unit.rowCount).toBe(1);
      const csv = 'nome,cpf,cargo,filial\nCsv Valido,12345678909,Op,Sede Csv\nCsv Invalido,12345678900,Op,Sede Csv\n';
      const r = await request(srv).post('/employees/import').set(auth(tokenA)).attach('file', Buffer.from(csv, 'utf-8'), 'f.csv');
      expect(r.status).toBe(201);
      expect(r.body.importados).toBe(1);
      expect(r.body.erros).toEqual([{ linha: 3, motivo: expect.stringContaining('CPF inválido') }]);
      const q = await sql('SELECT 1 FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, '12345678900']);
      expect(q.rowCount).toBe(0);
    });
  });
});
