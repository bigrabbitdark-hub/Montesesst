import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmployeeIngestionService } from '../src/employees/employee-ingestion.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// Contador próprio da rota de upload (RateLimitGuard): esta suíte faz dezenas de uploads do mesmo IP de loopback;
// zera entre os testes para não receber 429 (mesmo padrão de pente-fino-run.e2e-spec.ts).
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';

describe('Funcionários: ingestão por documento (e2e)', () => {
  let redis: Redis;
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);

  beforeAll(async () => {
    // R2 sempre falso: sem isso o upload gravaria no bucket real.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Ingestao A');
    const b = await db.createTenantWithUser('Empresa Ingestao B');
    tenantAId = a.tenantId;
    userAId = a.userId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Ingestao');
    tecnicoToken = await login(tec.email, tec.password);
    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('a CHECK de documents.category ganha cadastro_funcionarios sem perder nenhuma categoria existente', async () => {
    const def = (
      await sql(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass`,
      )
    ).rows[0].d as string;
    for (const c of [
      'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'cipa_ata', 'cipa_comunicado',
      'cipa_documento_eleitoral', 'cipa_anexo', 'ltcat', 'lip', 'relatorio_visita', 'cadastro_funcionarios',
    ]) {
      expect(def).toContain(`'${c}'`);
    }
  });

  it('employee_document_extractions: RLS+FORCE, só INSERT/SELECT/UPDATE para a role da aplicação (sem DELETE), único por (tenant, documento, hash)', async () => {
    const t = (
      await sql(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employee_document_extractions'`)
    ).rows[0];
    expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const priv = (
      await sql(
        `SELECT has_table_privilege('montese_app', 'employee_document_extractions', 'DELETE') AS del, has_table_privilege('montese_app', 'employee_document_extractions', 'UPDATE') AS upd`,
      )
    ).rows[0];
    expect(priv).toEqual({ del: false, upd: true });
    const uniq = (
      await sql(
        `SELECT 1 FROM pg_constraint WHERE conrelid = 'employee_document_extractions'::regclass AND contype = 'u'`,
      )
    ).rowCount;
    expect(uniq).toBe(1);
  });

  it('o upload genérico (POST /documents) não aceita a categoria cadastro_funcionarios', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set(auth(tokenA))
      .field('category', 'cadastro_funcionarios')
      .field('title', 'Tentativa')
      .attach('file', Buffer.from('%PDF-1.4 teste'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('category');
  });
  // ---- Bloco DO da migration 0082 (lido do próprio arquivo) ----
  const migrationSql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0082_employee_document_extractions.sql'), 'utf8');
  const doBlock = migrationSql.slice(migrationSql.indexOf('DO $$'), migrationSql.indexOf('END $$;') + 'END $$;'.length);
  const checkDef = async () =>
    (
      await sql(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass`,
      )
    ).rows[0].d as string;
  const itemsOf = (def: string) => [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const quoted = (items: string[]) => items.map((i) => `'${i}'::text`).join(', ');

  it('bloco DO: CHECK "de produção" com categoria extra ganha cadastro_funcionarios sem perder a extra', async () => {
    const base = itemsOf(await checkDef()).filter((c) => c !== 'cadastro_funcionarios');
    await sql('BEGIN');
    try {
      await sql(
        `ALTER TABLE documents DROP CONSTRAINT documents_category_check, ADD CONSTRAINT documents_category_check CHECK (category = ANY (ARRAY[${quoted([...base, 'categoria_de_producao'])}]))`,
      );
      const before = await checkDef();
      console.info('CHECK antes:', before);
      expect(before).not.toContain('cadastro_funcionarios');
      await sql(doBlock);
      const after = await checkDef();
      console.info('CHECK depois:', after);
      expect(after).toContain("'categoria_de_producao'");
      expect(after).toContain("'cadastro_funcionarios'");
      for (const c of base) expect(after).toContain(`'${c}'`);
      // Reexecutar é idempotente.
      await sql(doBlock);
      expect(await checkDef()).toBe(after);
    } finally {
      await sql('ROLLBACK');
    }
  });

  it('bloco DO: CHECK em formato inesperado aborta sem alterar nada', async () => {
    const base = itemsOf(await checkDef()).filter((c) => c !== 'cadastro_funcionarios');
    const variants = [
      `CHECK (category = ANY (ARRAY[${quoted(base)}]) AND length(title) > 0)`,
      `CHECK (category = ANY (ARRAY[${quoted(base)}]) OR category = ANY (ARRAY['outra'::text]))`,
    ];
    for (const check of variants) {
      await sql('BEGIN');
      try {
        await sql(`ALTER TABLE documents DROP CONSTRAINT documents_category_check, ADD CONSTRAINT documents_category_check ${check}`);
        const before = await checkDef();
        await sql('SAVEPOINT antes_do_bloco');
        await expect(sql(doBlock)).rejects.toThrow(/formato inesperado/);
        await sql('ROLLBACK TO SAVEPOINT antes_do_bloco');
        const after = await checkDef();
        expect(after).toBe(before);
        expect(after).not.toContain('cadastro_funcionarios');
      } finally {
        await sql('ROLLBACK');
      }
    }
  });

  it('política RLS na role da aplicação: empresa vê só o próprio tenant; técnico não vê; admin vê; WITH CHECK barra tenant alheio', async () => {
    const docId = (
      await sql(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, 'cadastro_funcionarios', 'Cadastro RLS', 'k/rls', 'rls.xlsx', 'application/octet-stream', 1, $2, 'empresa') RETURNING id`,
        [tenantAId, userAId],
      )
    ).rows[0].id as string;
    await sql(
      `INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1, $2, 'hash-rls', 'aplicado')`,
      [tenantAId, docId],
    );
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const asRole = async (role: string, tenant: string | null, fn: () => Promise<void>) => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.role', $1, true), set_config('app.tenant_id', $2, true)`, [role, tenant ?? '']);
        await fn();
      } finally {
        await app.query('ROLLBACK');
      }
    };
    const count = async () =>
      Number((await app.query(`SELECT count(*) AS n FROM employee_document_extractions WHERE document_id = $1`, [docId])).rows[0].n);
    try {
      expect((await app.query('SELECT current_user AS u')).rows[0].u).toBe('montese_app');
      await asRole('empresa', tenantAId, async () => expect(await count()).toBe(1));
      await asRole('empresa', tenantBId, async () => expect(await count()).toBe(0));
      await asRole('tecnico', tenantAId, async () => expect(await count()).toBe(0));
      await asRole('admin', null, async () => expect(await count()).toBeGreaterThanOrEqual(1));
      await asRole('empresa', tenantBId, async () => {
        await expect(
          app.query(
            `INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1, $2, 'hash-alheio', 'aplicado')`,
            [tenantAId, docId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
    } finally {
      await app.end();
      await sql(`DELETE FROM employee_document_extractions WHERE document_id = $1`, [docId]);
      await sql(`DELETE FROM documents WHERE id = $1`, [docId]);
    }
  });

  // ---- Task 4: upload, extração e leitura ----
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const HEADER = ['Funcionário', 'Matrícula eSocial', 'CPF', 'Data de Nascimento', 'Sexo F/M', 'Função/Cargo', 'Data de Admissão', 'CBO', 'Descrição da Atividade'];
  type R = { name?: string; mat?: string; cpf?: string; sex?: string; pos?: string; bd?: string; adm?: string; cbo?: string; act?: string };
  // Layout do modelo: título nas linhas 1–7, cabeçalho na 8, linha 9 vazia, dados a partir da 10.
  const xlsx = async (rows: R[], header: string[] | null = HEADER): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cadastro');
    ws.getCell('A1').value = 'CADASTRO DE FUNCIONARIOS (MODELO FICTICIO)';
    if (header) header.forEach((h, i) => (ws.getRow(8).getCell(i + 1).value = h));
    rows.forEach((r, i) => {
      const row = ws.getRow(10 + i);
      row.getCell(1).value = r.name ?? '';
      row.getCell(2).value = r.mat ?? '';
      row.getCell(3).value = r.cpf ?? '';
      row.getCell(4).value = r.bd ?? '';
      row.getCell(5).value = r.sex ?? '';
      row.getCell(6).value = r.pos ?? '';
      row.getCell(7).value = r.adm ?? '';
      row.getCell(8).value = r.cbo ?? '';
      row.getCell(9).value = r.act ?? '';
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const send = (token: string, buf: Buffer, unitId?: string, mime = XLSX, name = 'cadastro.xlsx') => {
    const rq = request(app.getHttpServer()).post('/employees/documents').set(auth(token));
    if (unitId) rq.field('company_unit_id', unitId);
    return rq.attach('file', buf, { filename: name, contentType: mime });
  };
  const createUnit = async (token: string, name: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/company-units')
      .set(auth(token))
      .send({ name, address_street: 'Rua T', address_city: 'Criciúma', address_state: 'SC', address_zip: '88801000' });
    expect(res.status).toBe(201);
    return res.body.id;
  };
  const createEmp = async (token: string, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).post('/employees').set(auth(token)).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };
  const empCount = async (tenant: string) =>
    Number((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1', [tenant])).rows[0].n);
  const C1 = '52998224725', C2 = '11144477735', C3 = '12345678909', C4 = '39053344705', C5 = '11122233396';
  let unitA: string, unitB: string;

  it('upload cria revisão e não cria funcionário; resposta sem CPF completo', async () => {
    unitA = await createUnit(tokenA, 'Filial Ing A');
    unitB = await createUnit(tokenA, 'Filial Ing B');
    const before = await empCount(tenantAId);
    const res = await send(tokenA, await xlsx([{ name: 'ANA FICTICIA', cpf: C1 }, { name: 'BRUNO FICTICIO', cpf: C2 }]), unitA);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    expect(res.body.summary.novo).toBe(2);
    expect(res.body.items[0]).toMatchObject({ kind: 'novo', full_name: 'ANA FICTICIA', cpf_masked: '***.***.***-25' });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(C1);
    expect(body).not.toContain(C2);
    expect(await empCount(tenantAId)).toBe(before);
    const docs = await sql(`SELECT count(*) AS n FROM documents WHERE tenant_id = $1 AND category = 'cadastro_funcionarios' AND title = 'cadastro'`, [tenantAId]);
    expect(Number(docs.rows[0].n)).toBe(1);
    const get = await request(app.getHttpServer()).get(`/employees/extractions/${res.body.id}`).set(auth(tokenA));
    expect(get.status).toBe(200);
    expect(JSON.stringify(get.body)).not.toContain(C1);
  });

  it('auto-aplica só campos vazios, com histórico source=documento; reenvio é idempotente', async () => {
    const emp = await createEmp(tokenA, { full_name: 'CARLA FICTICIA', cpf: C3, position: 'SOLDADORA', company_unit_id: unitA });
    const sheet = await xlsx([{ name: 'CARLA FICTICIA', cpf: C3, pos: 'GERENTE', sex: 'F' }]);
    const res = await send(tokenA, sheet, unitA);
    expect(res.status).toBe(201);
    expect(res.body.summary).toMatchObject({ applied: 1, conflito: 1 });
    const e = (await sql('SELECT sex, position FROM employees WHERE id = $1', [emp.id])).rows[0];
    expect(e).toEqual({ sex: 'F', position: 'SOLDADORA' });
    const hist = (await sql(`SELECT field, source FROM employee_field_history WHERE employee_id = $1 AND source = 'documento'`, [emp.id])).rows;
    expect(hist).toEqual([{ field: 'sex', source: 'documento' }]);
    const nHist = Number((await sql('SELECT count(*) AS n FROM employee_field_history WHERE employee_id = $1', [emp.id])).rows[0].n);
    // Reenvio do mesmo arquivo com extração pendente: reaproveita (200, reused), sem novo documento nem histórico.
    const again = await send(tokenA, sheet, unitA);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ reused: true, id: res.body.id });
    expect(again.body.summary).toMatchObject({ applied: 1, conflito: 1 });
    expect(Number((await sql('SELECT count(*) AS n FROM employee_field_history WHERE employee_id = $1', [emp.id])).rows[0].n)).toBe(nHist);
    // Planilha idêntica ao cadastro -> unchanged.
    const same = await send(tokenA, await xlsx([{ name: 'CARLA FICTICIA', cpf: C3, pos: 'SOLDADORA', sex: 'F' }]), unitA);
    expect(same.body.summary).toMatchObject({ applied: 0, unchanged: 1, conflito: 0 });
    expect(same.body.status).toBe('aplicado');
  });

  it('funcionário de outra filial vira conflito outra_filial e não é movido', async () => {
    const emp = await createEmp(tokenA, { full_name: 'DANIEL FICTICIO', cpf: C4, company_unit_id: unitA });
    const res = await send(tokenA, await xlsx([{ name: 'DANIEL FICTICIO', cpf: C4, sex: 'M' }]), unitB);
    expect(res.status).toBe(201);
    expect(res.body.items[0]).toMatchObject({ kind: 'conflito', reason: 'outra_filial' });
    const e = (await sql('SELECT company_unit_id, sex FROM employees WHERE id = $1', [emp.id])).rows[0];
    expect(e).toEqual({ company_unit_id: unitA, sex: null });
  });

  it('linha inválida não persiste nome nem CPF', async () => {
    const res = await send(tokenA, await xlsx([{ name: 'NOME SECRETO FICTICIO', cpf: '12345678900' }]), unitA);
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].kind).toBe('invalida');
    expect(res.body.items[0].full_name).toBeUndefined();
    const stored = (await sql('SELECT candidates::text AS c FROM employee_document_extractions WHERE id = $1', [res.body.id])).rows[0].c as string;
    expect(stored).not.toContain('SECRETO');
    expect(stored).not.toContain('12345678900');
  });

  it('colisão de matrícula na auto-aplicação vira invalida sem derrubar as outras linhas', async () => {
    await createEmp(tokenA, { full_name: 'ELISA FICTICIA', cpf: C5, esocial_registration: 'MAT-ING-1', company_unit_id: unitA });
    const a = await createEmp(tokenA, { full_name: 'FABIO FICTICIO', cpf: '98765432100', company_unit_id: unitA });
    const g = await createEmp(tokenA, { full_name: 'GISELE FICTICIA', cpf: '71428793860', company_unit_id: unitA });
    const res = await send(
      tokenA,
      await xlsx([
        { name: 'FABIO FICTICIO', cpf: '98765432100', mat: 'MAT-ING-1' },
        { name: 'GISELE FICTICIA', cpf: '71428793860', sex: 'F' },
      ]),
      unitA,
    );
    expect(res.status).toBe(201);
    expect(res.body.summary).toMatchObject({ applied: 1, invalida: 1 });
    const inv = res.body.items.find((i: any) => i.kind === 'invalida');
    expect(inv.reason).toBe('Matrícula eSocial já cadastrada nesta empresa');
    expect((await sql('SELECT esocial_registration FROM employees WHERE id = $1', [a.id])).rows[0].esocial_registration).toBeNull();
    expect((await sql('SELECT sex FROM employees WHERE id = $1', [g.id])).rows[0].sex).toBe('F');
  });

  it('documento de outro tenant: a extração falha e não grava', async () => {
    const docB = (
      await sql(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, 'cadastro_funcionarios', 'Doc B', 'k/b', 'b.xlsx', $2, 1, $3, 'empresa') RETURNING id`,
        [tenantBId, XLSX, userAId],
      )
    ).rows[0].id as string;
    const svc = app.get(EmployeeIngestionService);
    const c = await new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.role', 'empresa', true), set_config('app.tenant_id', $1, true)`, [tenantAId]);
      await expect(
        svc.createProcessing(c as any, { tenantId: tenantAId, documentId: docB, hash: 'h-alheio', actorUserId: userAId }),
      ).rejects.toThrow(/Documento não encontrado/);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
    expect((await sql('SELECT count(*) AS n FROM employee_document_extractions WHERE document_id = $1', [docB])).rows[0].n).toBe('0');
    await sql('DELETE FROM documents WHERE id = $1', [docB]);
  });

  it('formato, permissões, isolamento e planilha ilegível', async () => {
    // Na Fatia 4 PDF/DOCX passaram a ser aceitos (ver employee-ingestion-text); aqui fica o formato realmente recusado.
    const pdf = await send(tokenA, Buffer.from('texto'), undefined, 'text/plain', 'a.txt');
    expect(pdf.status).toBe(400);
    expect(pdf.body.message).toContain('.xlsx');
    expect((await send(tokenA, Buffer.from('bytes aleatorios nao xlsx'))).status).toBe(400);
    expect((await send(tecnicoToken, await xlsx([{ name: 'H FICTICIO', cpf: C1 }]))).status).toBe(403);
    const noFile = await request(app.getHttpServer()).post('/employees/documents').set(auth(tokenA));
    expect(noFile.status).toBe(400);

    const ext = await send(tokenA, await xlsx([{ name: 'IGOR FICTICIO', cpf: '15350946056' }]), unitA);
    expect(ext.status).toBe(201);
    const other = await request(app.getHttpServer()).get(`/employees/extractions/${ext.body.id}`).set(auth(tokenB));
    expect(other.status).toBe(404);
    const listB = await request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth(tokenB));
    expect(listB.status).toBe(200);
    expect(listB.body.items).toEqual([]);
    const listA = await request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth(tokenA));
    expect(listA.body.items.length).toBeGreaterThan(0);
    expect(listA.body.items.every((i: any) => i.status === 'requer_revisao')).toBe(true);
    expect((await request(app.getHttpServer()).get('/employees/extractions?status=aplicado').set(auth(tokenA))).status).toBe(400);

    const bad = await send(tokenA, await xlsx([{ name: 'J FICTICIO', cpf: C1 }], null));
    expect(bad.status).toBe(201);
    expect(bad.body.status).toBe('ilegivel');
    expect(bad.body.summary).toMatchObject({ applied: 0, unchanged: 0, novo: 0, conflito: 0, invalida: 0 });
  });

  it('uploads concorrentes: arquivos diferentes preenchendo o mesmo campo nunca sobrescrevem', async () => {
    const emp = await createEmp(tokenA, { full_name: 'LUCIA FICTICIA', cpf: '86288366757' });
    const mk = (sex: string) => xlsx([{ name: 'LUCIA FICTICIA', cpf: '86288366757', sex }]);
    const [r1, r2] = await Promise.all([send(tokenA, await mk('F')), send(tokenA, await mk('M'))]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const sex = (await sql('SELECT sex FROM employees WHERE id = $1', [emp.id])).rows[0].sex;
    expect(['F', 'M']).toContain(sex);
    const sums = [r1.body.summary, r2.body.summary];
    expect(sums.filter((x) => x.applied === 1)).toHaveLength(1);
    expect(sums.filter((x) => x.applied === 0 && x.conflito === 1)).toHaveLength(1);
  });

  it('uploads concorrentes do MESMO arquivo: 1 documento, 1 extração, o segundo reused', async () => {
    const buf = await xlsx([{ name: 'MARCOS FICTICIO', cpf: '24971563792' }]);
    const [r1, r2] = await Promise.all([send(tokenA, buf, undefined, XLSX, 'mesmo.xlsx'), send(tokenA, buf, undefined, XLSX, 'mesmo.xlsx')]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.id).toBe(r2.body.id);
    expect([r1.body.reused, r2.body.reused].filter(Boolean)).toEqual([true]);
    expect(r1.body.tenant_id).toBe(tenantAId);
    const docs = await sql(`SELECT count(*) AS n FROM documents WHERE tenant_id = $1 AND title = 'mesmo'`, [tenantAId]);
    expect(Number(docs.rows[0].n)).toBe(1);
    const again = await send(tokenA, buf, undefined, XLSX, 'mesmo.xlsx');
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);
  });

  it('extract não reprocessa extração finalizada; erro marca status erro com texto estático', async () => {
    const svc = app.get(EmployeeIngestionService);
    const res = await send(tokenA, await xlsx([{ name: 'NADIA FICTICIA', cpf: '07068093868' }]));
    const row = (await sql('SELECT * FROM employee_document_extractions WHERE id = $1', [res.body.id])).rows[0];
    const c = await new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.role', 'empresa', true), set_config('app.tenant_id', $1, true)`, [tenantAId]);
      const out = await svc.extract(c as any, {
        tenantId: tenantAId, extractionId: row.id, buffer: await xlsx([{ name: 'OUTRO FICTICIO', cpf: C1 }]), companyUnitId: null, actorUserId: userAId, actorRole: 'empresa',
      });
      expect(out.status).toBe('requer_revisao');
      expect(out.items).toHaveLength(1);
      // Discrimina: devolve a extração ORIGINAL (NADIA), não o resultado da planilha nova (OUTRO).
      expect(out.items[0].full_name).toBe('NADIA FICTICIA');
      expect(out.summary).toEqual(res.body.summary);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
    const doc = (await sql('SELECT document_id FROM employee_document_extractions WHERE id = $1', [res.body.id])).rows[0].document_id;
    const pid = (await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1,$2,'h-erro','processando') RETURNING id`, [tenantAId, doc])).rows[0].id;
    const c2 = await new Client({ connectionString: process.env.DATABASE_URL });
    await c2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(`SELECT set_config('app.role', 'empresa', true), set_config('app.tenant_id', $1, true)`, [tenantAId]);
      await svc.markError(c2 as any, tenantAId, pid);
      await c2.query('COMMIT');
    } finally {
      await c2.end();
    }
    const e = (await sql('SELECT status, summary FROM employee_document_extractions WHERE id = $1', [pid])).rows[0];
    expect(e.status).toBe('erro');
    expect(e.summary).toEqual({ detail: 'Falha ao processar a planilha' });
  });

  it('sem_dados, UUID inválido, técnico/parceiro 403 e isolamento com mesmo corpo de 404', async () => {
    const sd = await send(tokenA, await xlsx([]));
    expect(sd.status).toBe(201);
    expect(sd.body.status).toBe('sem_dados');
    const bad = await send(tokenA, await xlsx([{ name: 'X FICTICIO', cpf: C1 }], null));
    expect(bad.body.summary.detail).toContain('Cabeçalho não reconhecido');

    expect((await request(app.getHttpServer()).get('/employees/extractions/nao-e-uuid').set(auth(tokenA))).status).toBe(400);
    const par = await db.createUserWithRole('parceiro', 'Parceiro Ingestao');
    const parceiroToken = await login(par.email, par.password);
    for (const t of [tecnicoToken, parceiroToken]) {
      expect((await request(app.getHttpServer()).get('/employees/extractions').set(auth(t))).status).toBe(403);
      expect((await request(app.getHttpServer()).get(`/employees/extractions/${sd.body.id}`).set(auth(t))).status).toBe(403);
      expect((await send(t, await xlsx([{ name: 'Y FICTICIO', cpf: C1 }]))).status).toBe(403);
    }
    const alheio = await request(app.getHttpServer()).get(`/employees/extractions/${sd.body.id}`).set(auth(tokenB));
    const inexistente = await request(app.getHttpServer()).get('/employees/extractions/00000000-0000-4000-8000-000000000000').set(auth(tokenB));
    expect(alheio.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(alheio.body.message).toBe(inexistente.body.message);
  });

  it('admin: listagem exige tenant_id e filtra por ele; empresa ignora tenant_id alheio; company_unit_id não-string é 400', async () => {
    const adm = await db.createUserWithRole('admin', 'Admin Ingestao');
    const admToken = await login(adm.email, adm.password);
    const list = (t: string, q: string) => request(app.getHttpServer()).get(`/employees/extractions${q}`).set(auth(t));
    expect((await list(admToken, '')).status).toBe(400);
    expect((await list(admToken, '?tenant_id=xyz')).status).toBe(400);
    const a = await list(admToken, `?tenant_id=${tenantAId}`);
    expect(a.status).toBe(200);
    expect(a.body.items.length).toBeGreaterThan(0);
    expect(a.body.items.every((i: any) => i.tenant_id === tenantAId)).toBe(true);
    expect((await list(admToken, `?tenant_id=${tenantBId}`)).body.items).toEqual([]);
    const emp = await list(tokenB, `?tenant_id=${tenantAId}`);
    expect(emp.body.items).toEqual([]);
    const arr = await request(app.getHttpServer())
      .post('/employees/documents').set(auth(tokenA))
      .field('company_unit_id', unitA).field('company_unit_id', unitA)
      .attach('file', await xlsx([{ name: 'Z FICTICIO', cpf: C1 }]), { filename: 'z.xlsx', contentType: XLSX });
    expect(arr.status).toBe(400);
  });

  it('falha real na transação 2: 500, linha em erro sem PII, e o reenvio do mesmo arquivo cria nova extração', async () => {
    const spy = jest.spyOn(app.get(EmployeeIngestionService), 'extract').mockRejectedValueOnce(new Error('falha simulada WILMA FICTICIA 74185296355'));
    const buf = await xlsx([{ name: 'WILMA FICTICIA', cpf: '74185296355' }]);
    const bad = await send(tokenA, buf, undefined, XLSX, 'falha.xlsx');
    expect(bad.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const rows = (await sql(`SELECT d.id, d.status, d.summary, d.candidates::text AS c FROM employee_document_extractions d JOIN documents doc ON doc.id = d.document_id WHERE doc.tenant_id = $1 AND doc.title = 'falha'`, [tenantAId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('erro');
    expect(rows[0].summary).toEqual({ detail: 'Falha ao processar a planilha' });
    const dump = JSON.stringify(rows[0]);
    for (const s of ['WILMA', '74185296355', 'falha simulada']) expect(dump).not.toContain(s);
    expect(JSON.stringify(bad.body)).not.toContain('74185296355');

    const again = await send(tokenA, buf, undefined, XLSX, 'falha.xlsx');
    expect(again.status).toBe(201);
    expect(again.body.reused).toBeUndefined();
    expect(again.body.id).not.toBe(rows[0].id);
    expect(again.body.status).toBe('requer_revisao');
  });

  // ---- Task 5: resolver a revisão ----
  const resolve = (token: string, id: string, decisions: unknown) =>
    request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth(token)).send({ decisions });
  const extractionRow = async (id: string) =>
    (await sql('SELECT status, summary, candidates, candidates::text AS ctext, resolved_by, resolved_at FROM employee_document_extractions WHERE id = $1', [id])).rows[0];
  const lineOf = (body: any, kind: string, name?: string) =>
    body.items.find((i: any) => i.kind === kind && (!name || i.full_name === name)).line as number;

  it('resolve: aprovar novo cria via create (filial da extração) com histórico revisao; ignorar não cria; candidates sem PII', async () => {
    const CPF_A = '32014567808', CPF_B = '41023356767';
    const up = await send(tokenA, await xlsx([{ name: 'OLIVIA RESOLVE', cpf: CPF_A, sex: 'F', pos: 'ANALISTA', mat: 'MAT-RES-1', bd: '1990-05-17', adm: '2020-03-02', cbo: '212405', act: 'ANALISE FICTICIA' }, { name: 'PAULO RESOLVE', cpf: CPF_B }]), unitA);
    expect(up.status).toBe(201);
    const before = await empCount(tenantAId);
    const res = await resolve(tokenA, up.body.id, [
      { line: lineOf(up.body, 'novo', 'OLIVIA RESOLVE'), action: 'aplicar' },
      { line: lineOf(up.body, 'novo', 'PAULO RESOLVE'), action: 'ignorar' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('aplicado');
    expect(res.body.summary.resolved).toEqual({ aplicados: 1, ignorados: 1 });
    expect(res.body.items).toEqual([]);
    expect(res.body.resolved_at).not.toBeNull();
    expect(await empCount(tenantAId)).toBe(before + 1);
    const e = (await sql(`SELECT id, company_unit_id, sex, position, esocial_registration, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
        to_char(admission_date, 'YYYY-MM-DD') AS admission_date, cbo_code, activity_description FROM employees WHERE tenant_id = $1 AND cpf = $2`, [tenantAId, CPF_A])).rows[0];
    expect(e).toMatchObject({
      company_unit_id: unitA, sex: 'F', position: 'ANALISTA', esocial_registration: 'MAT-RES-1',
      birth_date: '1990-05-17', admission_date: '2020-03-02', cbo_code: '212405', activity_description: 'ANALISE FICTICIA',
    });
    expect((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, CPF_B])).rows[0].n).toBe('0');
    const hist = (await sql('SELECT DISTINCT source FROM employee_field_history WHERE employee_id = $1', [e.id])).rows;
    expect(hist).toEqual([{ source: 'revisao' }]);
    const row = await extractionRow(up.body.id);
    expect(row.status).toBe('aplicado');
    expect(row.resolved_by).toBe(userAId);
    expect(row.resolved_at).not.toBeNull();
    for (const s of ['OLIVIA', 'PAULO', CPF_A, CPF_B]) expect(row.ctext).not.toContain(s);
    expect(JSON.stringify(res.body)).not.toContain(CPF_A);
  });

  it('resolve: conflito aplica só os campos escolhidos (histórico revisao); o outro permanece', async () => {
    const CPF = '51877632104';
    const emp = await createEmp(tokenA, { full_name: 'QUITERIA RESOLVE', cpf: CPF, position: 'SOLDADORA', sex: 'M', company_unit_id: unitA });
    const up = await send(tokenA, await xlsx([{ name: 'QUITERIA RESOLVE', cpf: CPF, pos: 'GERENTE', sex: 'F' }]), unitA);
    expect(up.body.items[0].conflicts.map((c: any) => c.field).sort()).toEqual(['position', 'sex']);
    const res = await resolve(tokenA, up.body.id, [{ line: up.body.items[0].line, action: 'aplicar', fields: ['position'] }]);
    expect(res.status).toBe(200);
    expect(res.body.summary.resolved).toEqual({ aplicados: 1, ignorados: 0 });
    expect((await sql('SELECT position, sex FROM employees WHERE id = $1', [emp.id])).rows[0]).toEqual({ position: 'GERENTE', sex: 'M' });
    const hist = (await sql(`SELECT field, source FROM employee_field_history WHERE employee_id = $1 AND source = 'revisao'`, [emp.id])).rows;
    expect(hist).toEqual([{ field: 'position', source: 'revisao' }]);
    const ct = (await extractionRow(up.body.id)).ctext;
    expect(ct).not.toContain(CPF);
    expect(ct).not.toContain('QUITERIA');
  });

  it('resolve: decisões incompletas ou estranhas dão 400 e nada muda', async () => {
    const CPF_N = '62734158973', CPF_N2 = '73581926482', CPF_C = '84612037553';
    const emp = await createEmp(tokenA, { full_name: 'RITA RESOLVE', cpf: CPF_C, position: 'SOLDADORA', sex: 'M', company_unit_id: unitA });
    const up = await send(tokenA, await xlsx([{ name: 'SANDRA RESOLVE', cpf: CPF_N }, { name: 'TIAGO RESOLVE', cpf: CPF_N2 }, { name: 'RITA RESOLVE', cpf: CPF_C, pos: 'GERENTE', sex: 'F' }]), unitA);
    expect(up.status).toBe(201);
    const ln = lineOf(up.body, 'novo', 'SANDRA RESOLVE'), ln2 = lineOf(up.body, 'novo', 'TIAGO RESOLVE'), lc = lineOf(up.body, 'conflito');
    const before = await empCount(tenantAId);
    const bad: [string, unknown][] = [
      ['faltou item', [{ line: ln, action: 'aplicar' }, { line: lc, action: 'ignorar' }]],
      ['line inexistente', [{ line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'ignorar' }, { line: 9999, action: 'ignorar' }]],
      ['line repetida', [{ line: ln, action: 'ignorar' }, { line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'ignorar' }]],
      ['fields fora do conflito', [{ line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'aplicar', fields: ['cbo_code'] }]],
      ['fields vazio', [{ line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'aplicar', fields: [] }]],
      ['aplicar conflito sem fields', [{ line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'aplicar' }]],
      ['fields em novo', [{ line: ln, action: 'aplicar', fields: ['position'] }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'ignorar' }]],
      ['ignorar com fields', [{ line: ln, action: 'ignorar' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'ignorar', fields: ['position'] }]],
      ['action inválida', [{ line: ln, action: 'talvez' }, { line: ln2, action: 'ignorar' }, { line: lc, action: 'ignorar' }]],
      ['sem decisions', undefined],
    ];
    for (const [label, d] of bad) {
      const r = await resolve(tokenA, up.body.id, d);
      expect([label, r.status]).toEqual([label, 400]);
    }
    expect(await empCount(tenantAId)).toBe(before);
    expect((await sql('SELECT position, sex FROM employees WHERE id = $1', [emp.id])).rows[0]).toEqual({ position: 'SOLDADORA', sex: 'M' });
    expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
  });

  it('resolve: dado mudou desde a extração dá 409 e nada é aplicado (atomicidade)', async () => {
    const CPF_N = '95123746846', CPF_C = '26341857900';
    const emp = await createEmp(tokenA, { full_name: 'UMBELINA RESOLVE', cpf: CPF_C, position: 'SOLDADORA', company_unit_id: unitA });
    const up = await send(tokenA, await xlsx([{ name: 'VALERIO RESOLVE', cpf: CPF_N }, { name: 'UMBELINA RESOLVE', cpf: CPF_C, pos: 'GERENTE' }]), unitA);
    expect(up.status).toBe(201);
    const patch = await request(app.getHttpServer()).patch(`/employees/${emp.id}`).set(auth(tokenA)).send({ position: 'MOTORISTA' });
    expect(patch.status).toBe(200);
    const before = await empCount(tenantAId);
    const res = await resolve(tokenA, up.body.id, [
      { line: lineOf(up.body, 'novo'), action: 'aplicar' },
      { line: lineOf(up.body, 'conflito'), action: 'aplicar', fields: ['position'] },
    ]);
    expect(res.status).toBe(409);
    for (const s of ['SOLDADORA', 'MOTORISTA', 'GERENTE']) expect(JSON.stringify(res.body)).not.toContain(s);
    expect(await empCount(tenantAId)).toBe(before);
    expect((await sql('SELECT position FROM employees WHERE id = $1', [emp.id])).rows[0].position).toBe('MOTORISTA');
    expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
  });

  it('resolve: funcionário removido desde a extração dá 409', async () => {
    const CPF_C = '37452968182';
    const emp = await createEmp(tokenA, { full_name: 'XAVIER RESOLVE', cpf: CPF_C, position: 'SOLDADOR', company_unit_id: unitA });
    const up = await send(tokenA, await xlsx([{ name: 'XAVIER RESOLVE', cpf: CPF_C, pos: 'GERENTE' }]), unitA);
    await sql('DELETE FROM employees WHERE id = $1', [emp.id]);
    const res = await resolve(tokenA, up.body.id, [{ line: up.body.items[0].line, action: 'aplicar', fields: ['position'] }]);
    expect(res.status).toBe(409);
    expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
  });

  it('resolve: tenant no limite do plano -> 403 com mensagem do limite, nada criado, extração segue em revisão', async () => {
    const t = await db.createTenantWithUser('Empresa Ingestao Limite');
    const plan = await sql(`SELECT id FROM plans WHERE slug = 'empresa-start'`);
    await sql(`INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id) VALUES ($1, $2, 'authorized', $3)`, [plan.rows[0].id, t.tenantId, `test-preapproval-ing-${t.tenantId}`]);
    const existing = await empCount(t.tenantId);
    for (let i = 0; i < 10 - existing; i++) {
      await sql(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo')`, [t.tenantId, `Func Lim ${i}`, String(50000000000 + i)]);
    }
    const tok = await login(t.email, t.password);
    const up = await send(tok, await xlsx([{ name: 'YARA RESOLVE', cpf: '48563079247' }]));
    expect(up.status).toBe(201);
    const res = await resolve(tok, up.body.id, [{ line: up.body.items[0].line, action: 'aplicar' }]);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Limite de 10 funcionários do plano atingido. Faça upgrade para adicionar mais.');
    expect(await empCount(t.tenantId)).toBe(10);
    expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
  });

  it('resolve: segunda resolução 409; tenant B 404; técnico 403; admin 403; outra_filial + aplicar 400', async () => {
    const up = await send(tokenA, await xlsx([{ name: 'ZENILDA RESOLVE', cpf: '19119119100' }]), unitA);
    expect(up.status).toBe(201);
    const d = [{ line: up.body.items[0].line, action: 'ignorar' }];
    expect((await resolve(tokenB, up.body.id, d)).status).toBe(404);
    expect((await resolve(tecnicoToken, up.body.id, d)).status).toBe(403);
    const adm = await db.createUserWithRole('admin', 'Admin Resolve');
    expect((await resolve(await login(adm.email, adm.password), up.body.id, d)).status).toBe(403);
    expect((await resolve(tokenA, '00000000-0000-4000-8000-000000000000', d)).status).toBe(404);
    expect((await resolve(tokenA, 'nao-e-uuid', d)).status).toBe(400);
    expect((await resolve(tokenA, up.body.id, d)).status).toBe(200);
    const second = await resolve(tokenA, up.body.id, d);
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).not.toContain('ZENILDA');
    expect(JSON.stringify(second.body)).not.toContain('19119119100');

    // outra_filial: o funcionário de C4 já está na unitA (teste anterior); planilha na unitB.
    const out = await send(tokenA, await xlsx([{ name: 'DANIEL FICTICIO', cpf: C4, sex: 'F' }]), unitB);
    expect(out.body.items[0].reason).toBe('outra_filial');
    const ln = out.body.items[0].line;
    expect((await resolve(tokenA, out.body.id, [{ line: ln, action: 'aplicar', fields: ['sex'] }])).status).toBe(400);
    expect((await resolve(tokenA, out.body.id, [{ line: ln, action: 'aplicar' }])).status).toBe(400);
    expect((await extractionRow(out.body.id)).status).toBe('requer_revisao');
    expect((await resolve(tokenA, out.body.id, [{ line: ln, action: 'ignorar' }])).status).toBe(200);
  });

  it('resolve: duas resoluções simultâneas (só ignorar, sem efeito colateral único) -> exatamente uma 200 e uma 409; contado uma vez', async () => {
    const cpfs = ['56789012303', '14725836982', '25836914737'];
    for (let i = 0; i < 3; i++) {
      const up = await send(tokenA, await xlsx([{ name: `ALZIRA RESOLVE ${i}`, cpf: cpfs[i] }]), unitA);
      expect(up.status).toBe(201);
      const d = up.body.items.filter((x: any) => x.kind === 'novo').map((x: any) => ({ line: x.line, action: 'ignorar' }));
      expect(d).toHaveLength(1);
      const [r1, r2] = await Promise.all([resolve(tokenA, up.body.id, d), resolve(tokenA, up.body.id, d)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const ok = r1.status === 200 ? r1 : r2;
      expect(ok.body.summary.resolved).toEqual({ aplicados: 0, ignorados: 1 });
      expect((await extractionRow(up.body.id)).summary.resolved).toEqual({ aplicados: 0, ignorados: 1 });
    }
  });

  it('resolve: novo cujo CPF ou matrícula passou a existir desde a extração -> 409 estático, nada criado, extração segue pendente', async () => {
    const CPF_A = '36925814755', CPF_B = '47036925892';
    const up = await send(tokenA, await xlsx([{ name: 'CLEUSA RESOLVE', cpf: CPF_A }, { name: 'DIOGO RESOLVE', cpf: CPF_B }]), unitA);
    expect(up.status).toBe(201);
    await createEmp(tokenA, { full_name: 'DIOGO CADASTRADO', cpf: CPF_B, company_unit_id: unitA });
    const before = await empCount(tenantAId);
    const decisions = up.body.items.map((x: any) => ({ line: x.line, action: 'aplicar' }));
    const res = await resolve(tokenA, up.body.id, decisions);
    expect(res.status).toBe(409);
    for (const s of ['CLEUSA', 'DIOGO', CPF_A, CPF_B]) expect(JSON.stringify(res.body)).not.toContain(s);
    expect(await empCount(tenantAId)).toBe(before);
    expect((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, CPF_A])).rows[0].n).toBe('0');
    const row = await extractionRow(up.body.id);
    expect(row.status).toBe('requer_revisao');
    expect(row.candidates).toHaveLength(2);

    // Mesma matrícula em dois novos da mesma planilha.
    const up2 = await send(tokenA, await xlsx([{ name: 'ELIAS RESOLVE', cpf: '58147036957', mat: 'MAT-DUP-RES' }, { name: 'FATIMA RESOLVE', cpf: '69258147049', mat: 'MAT-DUP-RES' }]), unitA);
    expect(up2.status).toBe(201);
    expect(up2.body.summary.novo).toBe(2);
    const before2 = await empCount(tenantAId);
    const res2 = await resolve(tokenA, up2.body.id, up2.body.items.map((x: any) => ({ line: x.line, action: 'aplicar' })));
    expect(res2.status).toBe(409);
    expect(JSON.stringify(res2.body)).not.toContain('MAT-DUP-RES');
    expect(await empCount(tenantAId)).toBe(before2);
    expect((await extractionRow(up2.body.id)).status).toBe('requer_revisao');
  });

  it('resolve: nomes hostis em fields dão 400 e nada muda', async () => {
    const CPF = '70369258177';
    const emp = await createEmp(tokenA, { full_name: 'GUSTAVO RESOLVE', cpf: CPF, position: 'SOLDADOR', company_unit_id: unitA });
    const up = await send(tokenA, await xlsx([{ name: 'GUSTAVO RESOLVE', cpf: CPF, pos: 'GERENTE' }]), unitA);
    const line = up.body.items[0].line;
    for (const f of ['__proto__', 'status', 'tenant_id', 'company_unit_id']) {
      const r = await resolve(tokenA, up.body.id, [{ line, action: 'aplicar', fields: [f] }]);
      expect([f, r.status]).toEqual([f, 400]);
    }
    expect((await sql('SELECT position, status FROM employees WHERE id = $1', [emp.id])).rows[0]).toEqual({ position: 'SOLDADOR', status: 'ativo' });
    expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
  });
});
