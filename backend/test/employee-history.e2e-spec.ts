import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';
import { randomValidCnpj } from './helpers/cnpj';

const CPF_A = '52998224725';
const CPF_B = '11144477735';

describe('Funcionários: histórico campo a campo (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let parceiroToken: string;
  let userAId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);
  const history = (employeeId: string) =>
    sql(
      `SELECT field, old_value, new_value, actor_user_id, actor_role, source
         FROM employee_field_history WHERE employee_id = $1 ORDER BY field`,
      [employeeId],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Historico A');
    const b = await db.createTenantWithUser('Empresa Historico B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    userAId = (await sql('SELECT id FROM users WHERE email = $1', [a.email])).rows[0].id;
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Historico');
    tecnicoToken = await login(tec.email, tec.password);
    const par = await db.createUserWithRole('parceiro', 'Parceiro Historico');
    parceiroToken = await login(par.email, par.password);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const create = (body: Record<string, unknown>, token = tokenA) =>
    request(app.getHttpServer()).post('/employees').set(auth(token)).send(body);
  const patch = (id: string, body: Record<string, unknown>, token = tokenA) =>
    request(app.getHttpServer()).patch(`/employees/${id}`).set(auth(token)).send(body);

  it('cadastro grava uma linha por campo preenchido, com ator, papel e origem cadastro; CPF mascarado', async () => {
    const res = await create({ full_name: 'Hist Ana', cpf: CPF_A, position: 'Soldador', sex: 'F' });
    expect(res.status).toBe(201);
    const rows = (await history(res.body.id)).rows;
    expect(rows.map((r: any) => r.field)).toEqual(['cpf', 'full_name', 'position', 'sex', 'status']);
    const cpf = rows.find((r: any) => r.field === 'cpf');
    expect(cpf.new_value).toBe('***.***.***-25');
    expect(cpf.old_value).toBeNull();
    for (const r of rows) {
      expect(r.actor_user_id).toBe(userAId);
      expect(r.actor_role).toBe('empresa');
      expect(r.source).toBe('cadastro');
    }
    expect(JSON.stringify(rows)).not.toContain(CPF_A);
  });

  it('PATCH grava só o que mudou (old e new); sem mudança real não grava nada', async () => {
    const created = await create({ full_name: 'Hist Bruno', cpf: CPF_B, position: 'Eletricista' });
    const id = created.body.id;
    const before = (await history(id)).rowCount;

    const res = await patch(id, { position: 'Eletricista Sênior', full_name: 'Hist Bruno' });
    expect(res.status).toBe(200);
    const rows = (await history(id)).rows.filter((r: any) => r.field === 'position');
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.old_value === 'Eletricista')?.new_value).toBe('Eletricista Sênior');
    expect((await history(id)).rowCount).toBe(before + 1);

    const noop = await patch(id, { position: 'Eletricista Sênior' });
    expect(noop.status).toBe(200);
    expect((await history(id)).rowCount).toBe(before + 1);
  });

  it('matrícula única (registration_number) entra no histórico com esse nome de campo', async () => {
    const created = await create({ full_name: 'Hist Matricula', cpf: '86288366757', registration_number: 'HIST-M1' });
    expect(created.status).toBe(201);
    const res = await patch(created.body.id, { registration_number: 'HIST-M2' });
    expect(res.status).toBe(200);
    const rows = (await history(created.body.id)).rows.filter((r: any) => r.field === 'registration_number');
    expect(rows.map((r: any) => [r.old_value, r.new_value])).toEqual(
      expect.arrayContaining([[null, 'HIST-M1'], ['HIST-M1', 'HIST-M2']]),
    );
    expect((await history(created.body.id)).rows.some((r: any) => r.field === 'esocial_registration')).toBe(false);
  });

  it('alteração direta no banco (sem contexto da aplicação) também é registrada, sem ator', async () => {
    const created = await create({ full_name: 'Hist Direto', cpf: '40000007994' });
    await sql(`UPDATE employees SET position = 'Via SQL' WHERE id = $1`, [created.body.id]);
    const r = (await history(created.body.id)).rows.find((x: any) => x.field === 'position');
    expect(r).toMatchObject({ new_value: 'Via SQL', actor_user_id: null, source: 'cadastro' });
  });

  it('edição em lote grava origem tabela; cadastro segue cadastro', async () => {
    const created = await create({ full_name: 'Hist Lote', cpf: '40000004030', position: 'A' });
    const id = created.body.id;
    const rv = (await request(app.getHttpServer()).get('/employees/table?limit=200').set(auth(tokenA))).body.items.find(
      (r: any) => r.id === id,
    ).row_version;
    const res = await request(app.getHttpServer())
      .patch('/employees/bulk')
      .set(auth(tokenA))
      .send({ changes: [{ id, row_version: rv, fields: { position: 'B' } }] });
    expect(res.status).toBe(200);
    const rows = (await history(id)).rows;
    expect(rows.find((r: any) => r.field === 'position' && r.new_value === 'B').source).toBe('tabela');
    expect(rows.find((r: any) => r.field === 'position' && r.new_value === 'A').source).toBe('cadastro');
  });

  it('importação por planilha grava origem importacao', async () => {
    const csv = 'nome,cpf,cargo,filial\nHist Importado,52998224725,Operador,Sede\n';
    const tb = await db.createTenantWithUser('Empresa Historico Import');
    const t = await login(tb.email, tb.password);
    // O CSV exige filial existente.
    await request(app.getHttpServer()).post('/company-units').set(auth(t)).send({
      name: 'Sede',
      cnpj: randomValidCnpj(),
      address_street: 'Rua Import',
      address_city: 'Criciúma',
      address_state: 'SC',
      address_zip: '88801000',
    });
    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set(auth(t))
      .attach('file', Buffer.from(csv, 'utf-8'), 'funcionarios.csv');
    expect(res.status).toBe(201);
    expect({ i: res.body.importados, e: res.body.erros }).toEqual({ i: 1, e: [] });
    const r = await sql(
      `SELECT h.source FROM employee_field_history h JOIN employees e ON e.id = h.employee_id
        WHERE e.tenant_id = $1 AND e.full_name = 'Hist Importado'`,
      [tb.tenantId],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x: any) => x.source === 'importacao')).toBe(true);
  });

  const getHistory = (id: string, token: string, q = '') =>
    request(app.getHttpServer()).get(`/employees/${id}/history${q}`).set(auth(token));

  it('GET history devolve do mais novo para o mais antigo, com total, sem actor_user_id', async () => {
    const created = await create({ full_name: 'Hist Rota', cpf: '12345678909', position: 'P1' });
    await patch(created.body.id, { position: 'P2' });
    const res = await getHistory(created.body.id, tokenA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.items.length);
    expect(res.body.items[0].new_value).toBe('P2');
    expect(res.body.items[0].changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(res.body.items.every((i: any) => i.actor_user_id === undefined)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(userAId);
    // Só linhas do funcionário (e portanto do tenant A) consultado.
    const ids = res.body.items.map((i: any) => i.id);
    const rows = await sql(
      'SELECT tenant_id, employee_id FROM employee_field_history WHERE id = ANY($1::uuid[])',
      [ids],
    );
    expect(rows.rows).toHaveLength(ids.length);
    expect(rows.rows.every((r: any) => r.tenant_id === tenantAId && r.employee_id === created.body.id)).toBe(true);
    const paged = await getHistory(created.body.id, tokenA, '?limit=1&offset=1');
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(res.body.total);
  });

  it('histórico de funcionário de outro tenant é lista vazia (igual a id inexistente)', async () => {
    const created = await create({ full_name: 'Hist Alheio', cpf: '98765432100' });
    const own = await getHistory(created.body.id, tokenA);
    expect(own.body.total).toBeGreaterThan(0);
    const foreign = await getHistory(created.body.id, tokenB);
    const unknown = await getHistory('00000000-0000-4000-8000-000000000001', tokenB);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual({ items: [], total: 0 });
    expect(unknown.body).toEqual(foreign.body);
  });

  it('técnico recebe 403; id que não é UUID recebe 400; limit inválido recebe 400', async () => {
    const created = await create({ full_name: 'Hist Papel', cpf: '11122233396' });
    expect((await getHistory(created.body.id, tecnicoToken)).status).toBe(403);
    expect((await getHistory(created.body.id, parceiroToken)).status).toBe(403);
    expect((await getHistory('abc', tokenA)).status).toBe(400);
    for (const q of ['?offset=1e21', '?limit=abc', '?limit=0', '?limit=-1', '?limit=', '?limit=0x10']) {
      expect((await getHistory(created.body.id, tokenA, q)).status).toBe(400);
    }
    expect((await getHistory(created.body.id, tokenA, '?limit=999')).status).toBe(400);
  });

  it('a role da aplicação não consegue alterar nem apagar o histórico (append-only)', async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      // Garante que NÃO é superusuário (superusuário ignoraria o REVOKE).
      const who = await c.query('SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su');
      expect(who.rows[0].su).toBe(false);
      expect(who.rows[0].u).toBe('montese_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.role', 'admin', true)`);
      await expect(c.query(`UPDATE employee_field_history SET new_value = 'x'`)).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await expect(c.query(`DELETE FROM employee_field_history`)).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await expect(c.query(`TRUNCATE employee_field_history`)).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('PATCH de CPF grava old e new mascarados; nenhum CPF completo no histórico', async () => {
    const created = await create({ full_name: 'Hist Mascara', cpf: '52998224725' }, tokenB);
    expect(created.status).toBe(201);
    expect((await patch(created.body.id, { cpf: '11144477735' }, tokenB)).status).toBe(200);
    const rows = (await sql(`SELECT old_value, new_value FROM employee_field_history WHERE employee_id = $1 AND field = 'cpf' ORDER BY changed_at`, [created.body.id])).rows;
    expect(rows[rows.length - 1]).toEqual({ old_value: '***.***.***-25', new_value: '***.***.***-35' });
    const all = await sql(`SELECT * FROM employee_field_history WHERE employee_id = $1`, [created.body.id]);
    expect(JSON.stringify(all.rows)).not.toMatch(/52998224725|11144477735|\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });

  it('RLS: técnico e parceiro leem 0 linhas; empresa de outro tenant 0; admin lê', async () => {
    const existing = await sql('SELECT employee_id FROM employee_field_history WHERE tenant_id = $1 LIMIT 1', [tenantAId]);
    expect(existing.rows.length).toBe(1);
    const empId = existing.rows[0].employee_id;
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const count = async (role: string, tenant: string | null, onlyEmp: boolean) => {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.role', $1, true)`, [role]);
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant ?? '']);
        const r = onlyEmp
          ? await c.query('SELECT count(*)::int AS n FROM employee_field_history WHERE employee_id = $1', [empId])
          : await c.query('SELECT count(*)::int AS n FROM employee_field_history');
        return r.rows[0].n as number;
      } finally {
        await c.query('ROLLBACK');
      }
    };
    try {
      expect(await count('tecnico', tenantAId, false)).toBe(0);
      expect(await count('parceiro', tenantAId, false)).toBe(0);
      expect(await count('empresa', tenantBId, true)).toBe(0);
      expect(await count('empresa', tenantAId, true)).toBeGreaterThan(0);
      expect(await count('admin', null, false)).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });
});
