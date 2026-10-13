import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';
import { isValidCpf } from '../src/employees/employee-fields.util';

const CPF_OK = '52998224725';
const CPF_OK_2 = '11144477735';

describe('Funcionários: campos oficiais (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Official Table Teste');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/employees').set('Authorization', `Bearer ${empresaToken}`).send(body);

  it('cria funcionário com os campos do modelo e devolve cbo/matrícula como texto', async () => {
    const res = await post({
      full_name: 'Ana Teste',
      cpf: '529.982.247-25',
      sex: 'f',
      esocial_registration: '00012345678',
      cbo_code: '051210',
      position: 'Soldador',
      activity_description: 'Solda em campo',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cpf: CPF_OK,
      sex: 'F',
      esocial_registration: '00012345678',
      cbo_code: '051210',
      activity_description: 'Solda em campo',
    });
  });

  it('rejeita CPF com dígito verificador inválido (400, mensagem em português)', async () => {
    const res = await post({ full_name: 'Bia', cpf: '52998224726' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('CPF inválido');
  });

  it('matrícula repetida no mesmo tenant dá 409', async () => {
    const first = await post({ full_name: 'Caio', cpf: CPF_OK_2, esocial_registration: 'MAT-DUP-1' });
    expect(first.status).toBe(201);
    const second = await post({ full_name: 'Duda', cpf: '12345678909', esocial_registration: 'MAT-DUP-1' });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('Matrícula eSocial já cadastrada nesta empresa');
  });

  it('CPF repetido no mesmo tenant dá 409 com mensagem em português', async () => {
    const first = await post({ full_name: 'Fabi', cpf: '40000007994' });
    expect(first.status).toBe(201);
    const second = await post({ full_name: 'Fabi 2', cpf: '40000007994' });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('Registro duplicado');
  });

  it('update normaliza e valida os campos oficiais', async () => {
    const created = await post({ full_name: 'Edu', cpf: '40000004030' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const ok = await request(app.getHttpServer())
      .patch(`/employees/${id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ sex: 'm', cbo_code: 51210, activity_description: 'Operação' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sex: 'M', cbo_code: '051210', activity_description: 'Operação' });

    const bad = await request(app.getHttpServer())
      .patch(`/employees/${id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ cbo_code: '12ab34' });
    expect(bad.status).toBe(400);
  });
});

// CPF sintético válido (dígitos verificadores calculados) a partir de uma semente.
function makeCpf(seed: number): string {
  const base = String(300000000 + seed).slice(0, 9);
  const digits = base.split('').map(Number);
  for (const len of [9, 10]) {
    const sum = digits.slice(0, len).reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  const cpf = digits.join('');
  if (!isValidCpf(cpf)) throw new Error(`CPF de fixture inválido: ${cpf}`);
  return cpf;
}

describe('Funcionários: tabela oficial e PATCH /employees/bulk (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let unitAId: string;
  let unitBId: string;
  let seed = 100;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;

  const createUnit = async (token: string, name: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/company-units')
      .set(auth(token))
      .send({ name, address_street: 'Rua T', address_city: 'Criciúma', address_state: 'SC', address_zip: '88801000' });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  const createEmp = async (name: string, extra: Record<string, unknown> = {}) => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set(auth(tokenA))
      .send({ full_name: name, cpf: makeCpf(seed++), company_unit_id: unitAId, ...extra });
    expect(res.status).toBe(201);
    return res.body as { id: string; cpf: string };
  };

  const table = (token: string, query = '') =>
    request(app.getHttpServer()).get(`/employees/table${query}`).set(auth(token));

  const bulk = (token: string, changes: unknown) =>
    request(app.getHttpServer()).patch('/employees/bulk').set(auth(token)).send({ changes });

  const rowOf = async (id: string) => {
    const res = await table(tokenA, `?company_unit_id=${unitAId}&limit=200`);
    expect(res.status).toBe(200);
    return res.body.items.find((r: any) => r.id === id);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Tabela A');
    const b = await db.createTenantWithUser('Empresa Tabela B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Tabela');
    tecnicoToken = await login(tec.email, tec.password);
    unitAId = await createUnit(tokenA, 'Filial A1');
    unitBId = await createUnit(tokenB, 'Filial B1');
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /employees/table devolve datas como texto, sequence calculado e total', async () => {
    const emp = await createEmp('Tabela Ana', { birth_date: '1990-03-05', admission_date: '2020-01-15', cbo_code: '51210' });
    const res = await table(tokenA, `?company_unit_id=${unitAId}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.items[0];
    expect(row.id).toBe(emp.id);
    expect(row.birth_date).toBe('1990-03-05');
    expect(row.admission_date).toBe('2020-01-15');
    expect(row.cbo_code).toBe('051210');
    expect(typeof row.sequence).toBe('number');
    expect(row.sequence).toBe(1);
    expect(row.row_version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(row.tenant_id).toBeUndefined();
  });

  it('GET /employees/table não é tratado como :id (rota estática antes da dinâmica)', async () => {
    const res = await table(tokenA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /employees/table respeita paginação e filtro por filial', async () => {
    const unit2 = await createUnit(tokenA, 'Filial A2');
    for (const name of ['Pag 1', 'Pag 2', 'Pag 3']) {
      const r = await request(app.getHttpServer())
        .post('/employees')
        .set(auth(tokenA))
        .send({ full_name: name, cpf: makeCpf(seed++), company_unit_id: unit2 });
      expect(r.status).toBe(201);
    }

    const p1 = await table(tokenA, `?company_unit_id=${unit2}&limit=2&offset=0`);
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBe(3);
    expect(p1.body.items.map((r: any) => r.sequence)).toEqual([1, 2]);

    const p2 = await table(tokenA, `?company_unit_id=${unit2}&limit=2&offset=2`);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0].sequence).toBe(3);
    expect(p2.body.items[0].full_name).toBe('Pag 3');

    const other = await table(tokenA, `?company_unit_id=${unitAId}&limit=200`);
    expect(other.body.items.some((r: any) => r.full_name.startsWith('Pag'))).toBe(false);
  });

  it('PATCH /employees/bulk aplica alterações e devolve a tabela atualizada', async () => {
    const e1 = await createEmp('Bulk Um');
    const e2 = await createEmp('Bulk Dois');
    const r1 = await rowOf(e1.id);
    const r2 = await rowOf(e2.id);
    const res = await bulk(tokenA, [
      { id: e1.id, row_version: r1.row_version, fields: { position: 'Soldador', cbo_code: '51210', birth_date: '05/03/1991' } },
      { id: e2.id, row_version: r2.row_version, fields: { position: 'Eletricista', cbo_code: '715615' } },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const n1 = await rowOf(e1.id);
    const n2 = await rowOf(e2.id);
    expect(n1).toMatchObject({ position: 'Soldador', cbo_code: '051210', birth_date: '1991-03-05' });
    expect(n2).toMatchObject({ position: 'Eletricista', cbo_code: '715615' });
    expect(typeof n1.birth_date).toBe('string');
  });

  it('duas edições seguidas da mesma linha funcionam com o row_version novo devolvido', async () => {
    const e = await createEmp('Sequencial');
    const v0 = (await rowOf(e.id)).row_version;
    const first = await bulk(tokenA, [{ id: e.id, row_version: v0, fields: { position: 'Cargo 1' } }]);
    expect(first.status).toBe(200);
    const v1 = first.body.items.find((r: any) => r.id === e.id).row_version;
    expect(v1).not.toBe(v0);
    const second = await bulk(tokenA, [{ id: e.id, row_version: v1, fields: { position: 'Cargo 2' } }]);
    expect(second.status).toBe(200);
    expect((await rowOf(e.id)).position).toBe('Cargo 2');
  });

  it('PATCH /employees/bulk é atômico: um inválido reprova todos', async () => {
    const ok = await createEmp('Atomico Ok', { position: 'Original' });
    const bad = await createEmp('Atomico Ruim');
    const rOk = await rowOf(ok.id);
    const rBad = await rowOf(bad.id);
    const res = await bulk(tokenA, [
      { id: ok.id, row_version: rOk.row_version, fields: { position: 'Alterado' } },
      { id: bad.id, row_version: rBad.row_version, fields: { cpf: '52998224726' } },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.errors[`${bad.id}.cpf`]).toBe('CPF inválido');
    expect((await rowOf(ok.id)).position).toBe('Original');
  });

  it('PATCH /employees/bulk com row_version velha dá 409 e não altera nada', async () => {
    const a = await createEmp('Velha A', { position: 'A0' });
    const b = await createEmp('Velha B', { position: 'B0' });
    const ra = await rowOf(a.id);
    const rb = await rowOf(b.id);
    // alguém altera B por fora, tornando a versão de B velha
    const other = await bulk(tokenA, [{ id: b.id, row_version: rb.row_version, fields: { position: 'B-por-outro' } }]);
    expect(other.status).toBe(200);

    const res = await bulk(tokenA, [
      { id: a.id, row_version: ra.row_version, fields: { position: 'A1' } },
      { id: b.id, row_version: rb.row_version, fields: { position: 'B1' } },
    ]);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('alterada por outra pessoa');
    expect((await rowOf(a.id)).position).toBe('A0');
    expect((await rowOf(b.id)).position).toBe('B-por-outro');
  });

  it('PATCH /employees/bulk não altera funcionário de outro tenant (404 sem vazar existência)', async () => {
    const foreign = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, position, status)
       VALUES ($1, 'Estranho B', $2, 'Original B', 'ativo') RETURNING id`,
      [tenantBId, makeCpf(seed++)],
    );
    const foreignId = foreign.rows[0].id;
    const unknownId = '00000000-0000-4000-8000-000000000001';

    const res = await bulk(tokenA, [{ id: foreignId, row_version: '2020-01-01T00:00:00.000000Z', fields: { position: 'Invadido' } }]);
    const resUnknown = await bulk(tokenA, [{ id: unknownId, row_version: '2020-01-01T00:00:00.000000Z', fields: { position: 'X' } }]);
    expect(res.status).toBe(404);
    expect(resUnknown.status).toBe(404);
    expect(res.body.message).toBe(resUnknown.body.message);
    expect(JSON.stringify(res.body)).not.toContain(foreignId);

    const check = await (db as any).client.query('SELECT position FROM employees WHERE id = $1', [foreignId]);
    expect(check.rows[0].position).toBe('Original B');
  });

  it('campos desconhecidos (tenant_id, created_at) são ignorados e nunca gravados', async () => {
    const e = await createEmp('Mass Assign', { position: 'Fixo' });
    const r = await rowOf(e.id);
    const res = await bulk(tokenA, [
      {
        id: e.id,
        row_version: r.row_version,
        fields: { tenant_id: tenantBId, created_at: '2000-01-01', position: 'Novo' },
      },
    ]);
    expect(res.status).toBe(200);
    const check = await (db as any).client.query('SELECT tenant_id, position FROM employees WHERE id = $1', [e.id]);
    expect(check.rows[0].tenant_id).toBe(tenantAId);
    expect(check.rows[0].position).toBe('Novo');
  });

  it('PATCH /employees/bulk rejeita técnico (403) e lote vazio ou > 200 (400)', async () => {
    const forbidden = await bulk(tecnicoToken, [
      { id: '00000000-0000-4000-8000-000000000002', row_version: 'x', fields: { position: 'X' } },
    ]);
    expect(forbidden.status).toBe(403);

    const empty = await bulk(tokenA, []);
    expect(empty.status).toBe(400);

    const many = Array.from({ length: 201 }, () => ({
      id: '00000000-0000-4000-8000-000000000003',
      row_version: '2020-01-01T00:00:00.000000Z',
      fields: { position: 'X' },
    }));
    const tooMany = await bulk(tokenA, many);
    expect(tooMany.status).toBe(400);
  });

  it('filial de outro tenant em company_unit_id → 400 "Filial não encontrada"', async () => {
    const e = await createEmp('Filial Alheia');
    const r = await rowOf(e.id);
    const res = await bulk(tokenA, [{ id: e.id, row_version: r.row_version, fields: { company_unit_id: unitBId } }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Filial não encontrada');
    expect((await rowOf(e.id)).company_unit_id).toBe(unitAId);
  });

  // Rollback de verdade: a mudança 1 é escrita (UPDATE) ANTES de a mudança 2 falhar dentro do
  // laço de bulkUpdate (a validação prévia e a checagem de row_version já passaram).
  it('rollback no meio do lote: filial de outro tenant na mudança 2 desfaz a mudança 1 já escrita', async () => {
    const first = await createEmp('Rollback A1', { position: 'Original A1' });
    const second = await createEmp('Rollback A2', { position: 'Original A2' });
    const before1 = await rowOf(first.id);
    const before2 = await rowOf(second.id);
    // filial de OUTRO tenant criada direto pelo superuser
    const foreignUnit = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Alheia Rollback', 'Rua X', 'Cidade X', 'SC', '88800000') RETURNING id`,
      [tenantBId],
    );

    const res = await bulk(tokenA, [
      { id: first.id, row_version: before1.row_version, fields: { position: 'Mudou A1' } },
      { id: second.id, row_version: before2.row_version, fields: { company_unit_id: foreignUnit.rows[0].id } },
    ]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Filial não encontrada');

    const after1 = await rowOf(first.id);
    const after2 = await rowOf(second.id);
    expect(after1.position).toBe('Original A1');
    expect(after1.row_version).toBe(before1.row_version);
    expect(after2.company_unit_id).toBe(unitAId);
    expect(after2.row_version).toBe(before2.row_version);
  });

  it('rollback no meio do lote: CPF duplicado (23505) na mudança 2 desfaz a mudança 1 já escrita', async () => {
    const first = await createEmp('Rollback B1', { position: 'Original B1' });
    const second = await createEmp('Rollback B2');
    const third = await createEmp('Rollback B3');
    const before1 = await rowOf(first.id);
    const before2 = await rowOf(second.id);

    const res = await bulk(tokenA, [
      { id: first.id, row_version: before1.row_version, fields: { position: 'Mudou B1' } },
      { id: second.id, row_version: before2.row_version, fields: { cpf: third.cpf } },
    ]);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Registro duplicado');

    const after1 = await rowOf(first.id);
    const after2 = await rowOf(second.id);
    expect(after1.position).toBe('Original B1');
    expect(after1.row_version).toBe(before1.row_version);
    expect(after2.cpf).toBe(before2.cpf);
    expect(after2.row_version).toBe(before2.row_version);
  });
});
