import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

// beforeAll com bcrypt/tenants estoura os 5 s padrão sob carga do host.
jest.setTimeout(120_000);

describe('GET /epi-fichas/employees/:employeeId (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tokenB: string;
  let tenantId: string;
  let employeeId: string;
  let employeeId2: string;
  let employeeId3: string;
  let employeeId4: string;
  let employeeId5: string;
  let employeeId6: string;
  let employeeId7: string;
  let tokenTecLinked: string;
  let tokenTecFree: string;
  let tokenPartner: string;
  let tokenAdmin: string;
  let epiId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const authB = () => ({ Authorization: `Bearer ${tokenB}` });
  const mov = (id: string, body: Record<string, unknown>) =>
    request(srv).post(`/epis/${id}/movements`).set(auth()).send(body);
  let seq = 0;
  const key = () => `teste-ficha-${Date.now()}-${seq++}`;
  const ficha = (id: string, qs = '') => request(srv).get(`/epi-fichas/employees/${id}${qs}`).set(auth());

  const newEmployee = async (name: string, cpf: string) =>
    (
      await sql.query(
        `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`,
        [tenantId, name, cpf],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app); // espelha a produção (ValidationPipe global)
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();

    const t = await db.createTenantWithUser('Empresa Epi Ficha');
    tenantId = t.tenantId;
    employeeId = t.employeeId;
    token = (await request(srv).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    const b = await db.createTenantWithUser('Empresa Epi Ficha B');
    tokenB = (await request(srv).post('/auth/login').send({ email: b.email, password: b.password })).body.access_token;

    employeeId2 = await newEmployee('Funcionário Dois', '39053344705');
    employeeId3 = await newEmployee('Funcionário Três', '11144477735');
    employeeId4 = await newEmployee('Funcionário Quatro', '52998224725');
    employeeId5 = await newEmployee('Funcionário Cinco', '12345678909');

    employeeId6 = await newEmployee('Funcionário Seis', '98765432100');
    employeeId7 = await newEmployee('Funcionário Sete', '45317828791');

    // Papéis: técnico/parceiro vinculados ao tenant A, técnico sem vínculo e admin.
    const login = async (u: { email: string; password: string }) =>
      (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Ficha');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Ficha');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Ficha');
    const adm = await db.createUserWithRole('admin', 'Admin Ficha');
    const c = (db as any).client;
    const techId = (await c.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantId, techId]);
    await c.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    const partId = (await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantId, partId]);
    tokenTecLinked = await login(tecV);
    tokenTecFree = await login(tecF);
    tokenPartner = await login(parc);
    tokenAdmin = await login(adm);

    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    epiId = (
      await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-FICHA-1', manufacturer: 'Fab', model: 'M1' })
    ).body.id;
    const ab = await mov(epiId, { type: 'abertura', quantity: 100, idempotency_key: key() });
    expect(ab.status).toBe(201);
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('lista só movimentações reais do funcionário, em ordem cronológica, com CPF mascarado', async () => {
    await mov(epiId, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    await mov(epiId, { type: 'devolucao', quantity: 1, employee_id: employeeId, reason: 'Fim de uso', idempotency_key: key() });
    const r = await ficha(employeeId);
    expect(r.status).toBe(200);
    expect(r.body.employee.cpf_masked).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    expect(JSON.stringify(r.body)).not.toMatch(/\b\d{11}\b/); // nenhum CPF cru
    const types = r.body.lines.map((l: any) => l.type);
    expect(types).toEqual(['entrega', 'devolucao']);
    expect(r.body.lines[0]).toMatchObject({ quantity: 2, signature_status: 'pendente', reversed: false, source: 'livro' });
    expect(r.body.lines[1].signature_status).toBeNull(); // devolução não tem status próprio
    expect(r.body.term.draft).toBe(true);
  });

  it('nenhuma resposta de ficha contém 11 dígitos seguidos (CPF completo), nem em outro funcionário', async () => {
    for (const id of [employeeId, employeeId2, employeeId5]) {
      const r = await ficha(id);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/(?<![0-9A-Za-z])\d{11}(?![0-9A-Za-z])/); // exatamente 11 dígitos (o CNPJ tem 14)
      expect(JSON.stringify(r.body)).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/); // CPF formatado cru
    }
    // CPF conhecido: só 533.447 pode aparecer.
    const r2 = await ficha(employeeId2);
    expect(r2.body.employee.cpf_masked).toBe('***.533.447-**');
  });

  it('entrega estornada aparece marcada, o estorno aparece, nada some', async () => {
    const e = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId2, idempotency_key: key() });
    expect(e.status).toBe(201);
    const rev = await request(srv).post(`/epis/movements/${e.body.id}/reversal`).set(auth()).send({ reason: 'Entrega lançada por engano', idempotency_key: key() });
    expect(rev.status).toBe(201);
    const r = await ficha(employeeId2);
    const lines = r.body.lines;
    expect(lines.find((l: any) => l.type === 'entrega')).toMatchObject({ reversed: true, signature_status: 'estornada' });
    expect(lines.some((l: any) => l.type === 'estorno')).toBe(true);
  });

  it('entrega legada entra como legado, sem quantidade inventada', async () => {
    // A rota legada só vale para EPI sem livro de estoque: usa um EPI próprio, sem movimentações.
    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    const epiSemLivro = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[1].id, ca_number: 'CA-FICHA-LEG' })).body.id;
    const leg = await request(srv).post(`/epis/${epiSemLivro}/deliveries`).set(auth())
      .send({ employee_id: employeeId3, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });
    expect(leg.status).toBe(201);
    const r = await ficha(employeeId3);
    expect(r.body.lines).toHaveLength(1);
    expect(r.body.lines[0]).toMatchObject({ source: 'legado', type: 'entrega_legada', quantity: null, date: '2026-08-25', signature_status: 'legado' });
  });

  it('filtros por período e por situação da assinatura; datas inválidas -> 400', async () => {
    const ok = await ficha(employeeId, '?from=2020-01-01&to=2099-12-31&signature_status=pendente');
    expect(ok.status).toBe(200);
    expect(ok.body.lines.length).toBeGreaterThan(0);
    expect(ok.body.lines.every((l: any) => l.signature_status === 'pendente')).toBe(true);
    for (const q of ['from=abc', 'from=2026-02-30', 'to=2026', 'signature_status=nada', 'x=1', 'from=2026-01-01&from=2026-01-02', 'signature_status=pendente&signature_status=assinada']) {
      const r = await ficha(employeeId, `?${q}`);
      expect({ q, status: r.status }).toEqual({ q, status: 400 });
    }
    expect((await request(srv).get('/epi-fichas/employees/abc').set(auth())).status).toBe(400);
  });

  it('filtro de assinatura só alcança linhas com entrega vinculada: devolução e estorno ficam de fora', async () => {
    // employeeId2 tem entrega (estornada) + estorno; employeeId tem entrega (pendente) + devolução.
    const est = await ficha(employeeId2, '?signature_status=estornada');
    expect(est.body.lines.map((l: any) => l.type)).toEqual(['entrega']);
    const pen = await ficha(employeeId, '?signature_status=pendente');
    expect(pen.body.lines.map((l: any) => l.type)).toEqual(['entrega']);
    // Sem filtro, todas voltam.
    expect((await ficha(employeeId)).body.lines.map((l: any) => l.type)).toEqual(['entrega', 'devolucao']);
    // Legado entra no filtro 'legado'.
    expect((await ficha(employeeId3, '?signature_status=legado')).body.lines).toHaveLength(1);
    // Período fora do intervalo esvazia.
    expect((await ficha(employeeId3, '?from=2026-09-01')).body.lines).toHaveLength(0);
    expect((await ficha(employeeId3, '?to=2026-08-24')).body.lines).toHaveLength(0);
  });

  it('isolamento: empresa B recebe 404 para funcionário da A', async () => {
    expect((await request(srv).get(`/epi-fichas/employees/${employeeId}`).set(authB())).status).toBe(404);
  });

  it('papéis: técnico e parceiro vinculados e admin leem (200); técnico sem vínculo recebe 404', async () => {
    const get = (t: string) => request(srv).get(`/epi-fichas/employees/${employeeId}`).set({ Authorization: `Bearer ${t}` });
    const tv = await get(tokenTecLinked);
    expect(tv.status).toBe(200);
    expect(tv.body.employee.id).toBe(employeeId);
    expect((await get(tokenPartner)).status).toBe(200);
    const adm = await get(tokenAdmin);
    expect(adm.status).toBe(200); // o tenant vem da linha do funcionário
    expect(adm.body.company.cnpj).toBeTruthy();
    expect((await get(tokenTecFree)).status).toBe(404);
  });

  it('filtro que exclui o ramo legado: signature_status=pendente em quem só tem entrega legada -> vazio', async () => {
    const r = await ficha(employeeId3, '?signature_status=pendente');
    expect(r.status).toBe(200);
    expect(r.body.lines).toEqual([]);
  });

  it('sem autenticação: 401', async () => {
    expect((await request(srv).get(`/epi-fichas/employees/${employeeId}`)).status).toBe(401);
  });

  it('matrícula e setor ausentes viram null; preenchidos aparecem', async () => {
    const vazio = await ficha(employeeId5);
    expect(vazio.body.employee).toMatchObject({ registration_number: null, department: null });
    await sql.query('UPDATE employees SET registration_number = $2, department = $3 WHERE id = $1', [employeeId, 'M-7', 'Obra']);
    const r = await ficha(employeeId);
    expect(r.body.employee).toMatchObject({ registration_number: 'M-7', department: 'Obra' });
  });

  it('ficha muito grande é recusada com 400 (limite de linhas)', async () => {
    const big = await db.createTenantWithUser('Empresa Ficha Grande');
    const bigToken = (await request(srv).post('/auth/login').send({ email: big.email, password: big.password })).body.access_token;
    const cat = await sql.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 1');
    const bigEpi = (await sql.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id) VALUES ($1,$2,'CA-GRANDE',$3) RETURNING id`,
      [big.tenantId, cat.rows[0].id, big.userId],
    )).rows[0].id;
    await sql.query(
      `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, employee_id, idempotency_key, created_by_user_id)
       SELECT $1, $2, 'devolucao', 1, 1, 1, $3, 'grande-' || g, $4 FROM generate_series(1, 1001) g`,
      [big.tenantId, bigEpi, big.employeeId, big.userId],
    );
    const r = await request(srv).get(`/epi-fichas/employees/${big.employeeId}`).set('Authorization', `Bearer ${bigToken}`);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/muito grande/i);
    const ok = await ficha(employeeId);
    expect(ok.status).toBe(200); // o limite não afeta fichas normais
  });

  it('delivered_at da entrega do livro usa o dia de São Paulo', async () => {
    // 2026-10-14T01:30:00Z = 13/10 22:30 em São Paulo
    const r = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId4, occurred_at: '2026-10-14T01:30:00Z', idempotency_key: key() });
    expect(r.status).toBe(201);
    const d = await sql.query(`SELECT to_char(delivered_at, 'YYYY-MM-DD') AS d FROM employee_epi_deliveries WHERE id = $1`, [r.body.delivery_id]);
    expect(d.rows[0].d).toBe('2026-10-13');
    const f = await ficha(employeeId4);
    expect(f.body.lines[0].date).toBe('2026-10-13');
  });

  it('occurred_at só com data fica no mesmo dia em São Paulo (entrega, livro e ficha)', async () => {
    const r = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId6, occurred_at: '2026-10-14', idempotency_key: key() });
    expect(r.status).toBe(201);
    const d = await sql.query(`SELECT to_char(delivered_at, 'YYYY-MM-DD') AS d FROM employee_epi_deliveries WHERE id = $1`, [r.body.delivery_id]);
    expect(d.rows[0].d).toBe('2026-10-14');
    const f = await ficha(employeeId6);
    expect(f.body.lines[0].date).toBe('2026-10-14');
  });

  it('occurred_at sem offset é horário de São Paulo (23:30 continua no dia 14)', async () => {
    const r = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId7, occurred_at: '2026-10-14T23:30', idempotency_key: key() });
    expect(r.status).toBe(201);
    const d = await sql.query(`SELECT to_char(delivered_at, 'YYYY-MM-DD') AS d FROM employee_epi_deliveries WHERE id = $1`, [r.body.delivery_id]);
    expect(d.rows[0].d).toBe('2026-10-14');
    expect((await ficha(employeeId7)).body.lines[0].date).toBe('2026-10-14');
  });
});
