import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as jsonwebtoken from 'jsonwebtoken';
import request from 'supertest';
import { TestDb, TestTenantFixture, TestUserFixture } from './db-test-helper';

// Task 9 (spec 2026-11-05 "sócia cadastra e atua como empresa", §3 e §7): critério de aceitação central.
// Prova ponta a ponta (HTTP → guards → interceptor → RLS real) que o token de atuação isola tenants.
// Roda SOMENTE no ensaio descartável (rede montese_ensaio_socio). Nenhuma credencial real:
// MercadoPago, R2 e o indexador de embeddings são mocks (overrideProvider).

// Limites de taxa: os decorators leem o env ao CARREGAR o módulo; por isso o AppModule é
// carregado com require() dentro do beforeAll, depois destas linhas (import seria içado).
process.env.RATE_LIMIT_MAX = '5000';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.CHANGE_PASSWORD_RATE_LIMIT_MAX = '1000';
process.env.SOCIO_CREATE_COMPANY_RATE_LIMIT_MAX = '1000';
process.env.SOCIO_ATUAR_RATE_LIMIT_MAX = '1000';
// RateLimitGuard roda ANTES do ActingTenantGuard e o contador fica no Redis entre execuções:
// sem isto, a 6ª execução recebe 429 (e não 403) nas rotas negadas com limite apertado.
process.env.PENTE_FINO_RUN_RATE_LIMIT_MAX = '1000';
process.env.DOCUMENTS_CLASSIFY_BATCH_RATE_LIMIT_MAX = '1000';
process.env.ASSISTANT_RATE_LIMIT_MAX = '1000';

// CNPJ válido (módulo 11) e distinto por chamada — o CNPJ do tenant é único.
function gerarCnpj(): string {
  const w12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv = (base: string, w: number[]) => {
    const r = base.split('').reduce((acc, ch, i) => acc + Number(ch) * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  let base = '';
  for (let i = 0; i < 8; i++) base += Math.floor(Math.random() * 10);
  base += '0001';
  const d1 = dv(base, w12);
  const d2 = dv(base + d1, w13);
  return `${base}${d1}${d2}`;
}

const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));

describe('socio atua como empresa — isolamento e papéis (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socio: TestUserFixture;
  let semPerm: TestUserFixture;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let parceiro: TestUserFixture;
  let P: TestTenantFixture; // empresa com PARCEIRO vinculado
  let partnerId: string;
  let A: TestTenantFixture, B: TestTenantFixture, C: TestTenantFixture; // A,B = Montese; C = com técnico
  let tSocio: string, tSemPerm: string, tAdmin: string, tTec: string, tPar: string, tEmpA: string, tEmpB: string;
  const sufixo = randomUUID().slice(0, 8);
  const criados: string[] = []; // tenants criados pela sócia via HTTP
  const tenantsExtras: TestTenantFixture[] = []; // D, E... (o helper limpa, guardamos para a auditoria)
  // Linhas de fixture por tenant (ids), para o teste por tabela.
  const fx: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };
  const indexer = {
    shouldIndex: jest.fn(() => true),
    extractAndEmbed: jest.fn(async () => []),
    persistChunks: jest.fn(async () => undefined),
  };
  const r2 = {
    putObject: jest.fn(async () => undefined),
    deleteObject: jest.fn(async () => undefined),
    getPresignedDownloadUrl: jest.fn(async () => 'https://exemplo.invalid/x'),
    getObject: jest.fn(async () => Buffer.from('')),
  };

  const http = () => request(app.getHttpServer());
  const login = async (u: { email: string; password: string }) =>
    (await http().post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const atuar = (t: string, tenantId: string) => http().post(`/atuacao/clientes/${tenantId}/atuar`).set(auth(t));
  const tokenDe = async (tenantId: string) => {
    const r = await atuar(tSocio, tenantId);
    if (r.status !== 201) throw new Error(`atuar ${tenantId} => ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.access_token as string;
  };
  const get = (t: string, path: string) => http().get(path).set(auth(t));
  const novoTenant = async (nome: string) => {
    const t = await db.createTenantWithUser(nome);
    tenantsExtras.push(t);
    return t;
  };

  async function fixturesDoTenant(t: TestTenantFixture, k: 'A' | 'B') {
    const q = async (sql: string, p: unknown[]) => (await db.client.query(sql, p)).rows[0].id as string;
    fx[k].employee = t.employeeId;
    fx[k].position = await q('INSERT INTO positions (tenant_id, name) VALUES ($1,$2) RETURNING id', [t.tenantId, `Cargo ${k} ${sufixo}`]);
    fx[k].unit = await q(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1,$2,'Rua X','Cidade','SP','01001000') RETURNING id`,
      [t.tenantId, `Unidade ${k} ${sufixo}`],
    );
    fx[k].document = await q(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1,'pgr',$2,$3,'x.pdf','application/pdf',10,$4,'empresa') RETURNING id`,
      [t.tenantId, `Doc ${k} ${sufixo}`, `tenants/${t.tenantId}/documents/fixture/x.pdf`, t.userId],
    );
    const cat = (await db.client.query('SELECT id FROM epi_catalog_items ORDER BY id LIMIT 1')).rows[0].id;
    fx[k].epi = await q(
      'INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [t.tenantId, cat, `CA${k}${sufixo}`, t.userId],
    );
    fx[k].committee = await q(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1,$2,2026,'2026-01-01','2026-12-31',$3) RETURNING id`,
      [t.tenantId, fx[k].unit, t.userId],
    );
    fx[k].brigade = await q(
      `INSERT INTO fire_brigade_members (tenant_id, company_unit_id, employee_id, funcao_brigada)
       VALUES ($1,$2,$3,'brigadista') RETURNING id`,
      [t.tenantId, fx[k].unit, t.employeeId],
    );
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApp } = require('../src/app-setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MercadoPagoService } = require('../src/payments/mercadopago.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { R2Service } = require('../src/common/r2/r2.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CompanyDocumentIndexerService } = require('../src/documents/company-document-indexer.service');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue(r2)
      .overrideProvider(CompanyDocumentIndexerService).useValue(indexer)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', `Socia ${sufixo}`);
    semPerm = await db.createUserWithRole('socio', `Socia sem perm ${sufixo}`);
    admin = await db.createUserWithRole('admin', `Admin ${sufixo}`);
    tecnico = await db.createUserWithRole('tecnico', `Tec ${sufixo}`);
    parceiro = await db.createUserWithRole('parceiro', `Parc ${sufixo}`);
    for (const p of ['empresas.atuar', 'empresas.criar', 'clients.read']) await db.grantSocioPermission(socio.userId, p);
    await db.grantSocioPermission(semPerm.userId, 'clients.read');
    A = await db.createTenantWithUser(`A ${sufixo}`);
    B = await db.createTenantWithUser(`B ${sufixo}`);
    C = await db.createTenantWithUser(`C ${sufixo}`);
    P = await db.createTenantWithUser(`P ${sufixo}`);
    partnerId = (await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul') RETURNING id", [parceiro.userId])).rows[0].id;
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1,$2)', [P.tenantId, partnerId]);
    // Como C: no portfólio, is_montese_tenant(P)=true e a leitura de tenants pela sócia NÃO esconde P — só
    // socio_can_act_on_tenant segura a emissão (sem isto, o RLS de tenants recusaria sozinho e mascararia a função).
    await db.client.query('INSERT INTO socio_portfolio (tenant_id) VALUES ($1)', [P.tenantId]);
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [C.tenantId, tec.rows[0].id]);
    // Ruling 6: mesmo no portfólio da sócia, empresa com técnico NÃO pode ser atuada.
    await db.client.query('INSERT INTO socio_portfolio (tenant_id) VALUES ($1)', [C.tenantId]);
    await fixturesDoTenant(A, 'A');
    await fixturesDoTenant(B, 'B');
    // Marcadores do dashboard: A e B DISTINGUÍVEIS (documento vencido com título único + 1 funcionário a mais em A).
    for (const [t, k] of [[A, 'A'], [B, 'B']] as Array<[TestTenantFixture, string]>) {
      await db.client.query(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role, expires_at)
         VALUES ($1,'pcmso',$2,$3,'v.pdf','application/pdf',10,$4,'empresa', CURRENT_DATE - 10)`,
        [t.tenantId, `Doc vencido ${k} ${sufixo}`, `tenants/${t.tenantId}/documents/vencido/v.pdf`, t.userId],
      );
    }
    await db.client.query("INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1,'Extra A',$2,'ativo')", [A.tenantId, String(Date.now()).slice(-11).padStart(11, '7')]);
    [tSocio, tSemPerm, tAdmin, tTec, tPar, tEmpA, tEmpB] = await Promise.all([socio, semPerm, admin, tecnico, parceiro, A, B].map(login));
  }, 120000);

  afterAll(async () => {
    const tentar = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('limpeza:', (e as Error).message);
      }
    };
    if (db) {
      const tenantIds = [A, B, C, P, ...tenantsExtras].filter(Boolean).map((t) => t.tenantId).concat(criados);
      const userIds = [socio, semPerm, admin, tecnico, parceiro].filter(Boolean).map((u) => u.userId)
        .concat([A, B, C, P, ...tenantsExtras].filter(Boolean).map((t) => t.userId));
      await tentar(async () => {
        const rh = await db.client.query('SELECT id FROM users WHERE tenant_id = ANY($1)', [criados]);
        userIds.push(...rh.rows.map((r: { id: string }) => r.id));
      });
      await tentar(() => db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1) OR actor_tenant_id = ANY($2)', [userIds, tenantIds]));
      await tentar(() => db.client.query('DELETE FROM tenants WHERE id = ANY($1)', [criados]));
      await tentar(() => db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1)', [userIds]));
      await tentar(() => db.client.query('DELETE FROM technicians WHERE user_id = ANY($1)', [userIds]));
      await tentar(() => db.cleanup());
      await tentar(() => db.disconnect());
    }
    if (app) await app.close();
  });

  describe('emissão do token', () => {
    it('sócia com permissão obtém token (30 min) para empresa Montese; claims corretos', async () => {
      const r = await atuar(tSocio, A.tenantId);
      expect(r.status).toBe(201);
      expect(r.body.expires_in).toBe(1800);
      expect(typeof r.body.access_token).toBe('string');
      const p = decode(r.body.access_token);
      expect(p).toMatchObject({ sub: socio.userId, role: 'socio', act: A.tenantId, tenantId: null });
      expect(p.exp - p.iat).toBe(1800);
      expect(p.mcp).toBeUndefined();
    });
    it('empresa com vínculo de técnico é recusada (mesmo estando no socio_portfolio)', async () => {
      const r = await atuar(tSocio, C.tenantId);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it('sócia sem empresas.atuar é recusada', async () => expect((await atuar(tSemPerm, A.tenantId)).status).toBe(403));
    it('empresa com vínculo de PARCEIRO é recusada (mesmo estando no socio_portfolio)', async () => {
      const r = await atuar(tSocio, P.tenantId);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it.each([['empresa', () => tEmpA], ['tecnico', () => tTec], ['parceiro', () => tPar], ['admin', () => tAdmin]])('papel %s não emite token', async (_n, tok) => {
      expect((await atuar(tok(), A.tenantId)).status).toBe(403);
    });
    it('tenant inexistente é recusado', async () => expect((await atuar(tSocio, randomUUID())).status).toBe(403));
    it('tenant inativo é recusado na emissão e derruba token já emitido', async () => {
      const E = await novoTenant(`Inativo ${sufixo}`);
      const t = await tokenDe(E.tenantId);
      await db.client.query("UPDATE tenants SET status='inativo' WHERE id=$1", [E.tenantId]);
      expect((await atuar(tSocio, E.tenantId)).status).toBe(403);
      const r = await get(t, '/employees');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
  });

  describe('token de atuação inválido => 401; token comum da sócia segue funcionando', () => {
    const segredo = () => process.env.JWT_SECRET as string;
    it('expirado => 401', async () => {
      const t = jsonwebtoken.sign(
        { sub: socio.userId, tenantId: null, role: 'socio', act: A.tenantId, exp: Math.floor(Date.now() / 1000) - 60 },
        segredo(),
      );
      expect((await get(t, '/employees')).status).toBe(401);
    });
    it('payload adulterado (act trocado para B, assinatura de A) => 401', async () => {
      const t = await tokenDe(A.tenantId);
      const [h, p, s] = t.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      payload.act = B.tenantId;
      const forjado = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
      const r = await get(forjado, '/employees');
      expect(r.status).toBe(401);
      expect(JSON.stringify(r.body)).not.toContain(B.employeeId);
    });
    it('assinado com outro segredo => 401', async () => {
      const t = jsonwebtoken.sign({ sub: socio.userId, tenantId: null, role: 'socio', act: A.tenantId }, 'segredo-errado', { expiresIn: 600 });
      expect((await get(t, '/employees')).status).toBe(401);
    });
    it.each([
      ['act com papel empresa', { role: 'empresa', tenantId: null }],
      ['act com papel parceiro', { role: 'parceiro', tenantId: null }],
      ['act com purpose', { role: 'socio', tenantId: null, purpose: 'reset' }],
    ])('%s (assinado com o segredo certo) => 401', async (_n, extra) => {
      const t = jsonwebtoken.sign({ sub: socio.userId, act: A.tenantId, ...extra }, segredo(), { expiresIn: 600 });
      expect((await get(t, '/employees')).status).toBe(401);
    });
    it('act que não é uuid => 401', async () => {
      const t = jsonwebtoken.sign({ sub: socio.userId, tenantId: null, role: 'socio', act: 'nao-uuid' }, segredo(), { expiresIn: 600 });
      expect((await get(t, '/employees')).status).toBe(401);
    });
    it('regressão: token comum da sócia continua nas rotas /atuacao/*', async () => {
      expect((await get(tSocio, '/atuacao/clientes')).status).toBe(200);
      expect((await atuar(tSocio, B.tenantId)).status).toBe(201);
      // e o token comum da sócia NÃO lê /employees como empresa (papel socio, sem act)
      expect((await get(tSocio, '/employees')).status).toBe(403);
    });
  });

  describe('uso do token de atuação — leitura por tabela/controller liberado', () => {
    const casos: Array<[string, string, string]> = [
      ['employees', '/employees', 'employee'],
      ['positions', '/positions', 'position'],
      ['company-units', '/company-units', 'unit'],
      ['documents', '/documents', 'document'],
      ['epis', '/epis', 'epi'],
      ['cipa/committees', '/cipa/committees', 'committee'],
      ['fire-brigade', '/fire-brigade/members', 'brigade'],
    ];
    it.each(casos)('%s: 200, igual à visão do RH de A, contém A e nunca B', async (_n, path, chave) => {
      const ta = await tokenDe(A.tenantId);
      const r = await get(ta, path);
      expect(r.status).toBe(200);
      const txt = JSON.stringify(r.body);
      expect(txt).toContain(fx.A[chave]);
      expect(txt).not.toContain(fx.B[chave]);
      expect(txt).not.toContain(B.tenantId);
      expect(txt).not.toContain(C.tenantId);
      const doRh = await get(tEmpA, path);
      expect(r.body).toEqual(doRh.body);
      // e o token de B enxerga B e não A
      const tb = await tokenDe(B.tenantId);
      const rb = JSON.stringify((await get(tb, path)).body);
      expect(rb).toContain(fx.B[chave]);
      expect(rb).not.toContain(fx.A[chave]);
    });
    it('dashboard/summary: 200 e idêntico ao do RH de A (e o de B ao do RH de B)', async () => {
      // updated_at é o instante do cálculo (muda a cada chamada): fica fora da comparação.
      const semHora = (b: any) => ({ ...b, updated_at: undefined });
      const ta = await tokenDe(A.tenantId);
      const r = await get(ta, '/dashboard/summary');
      expect(r.status).toBe(200);
      expect(semHora(r.body)).toEqual(semHora((await get(tEmpA, '/dashboard/summary')).body));
      expect(JSON.stringify(r.body)).not.toContain(B.tenantId);
      const tb = await tokenDe(B.tenantId);
      const rb = await get(tb, '/dashboard/summary');
      expect(rb.status).toBe(200);
      const doRhB = (await get(tEmpB, '/dashboard/summary')).body;
      expect(semHora(rb.body)).toEqual(semHora(doRhB));
      // A e B são distinguíveis: marcador próprio presente, o do outro ausente, e contagens diferentes.
      const txtA = JSON.stringify(r.body);
      const txtB = JSON.stringify(rb.body);
      expect(txtA).toContain(`Doc vencido A ${sufixo}`);
      expect(txtA).not.toContain(`Doc vencido B ${sufixo}`);
      expect(txtB).toContain(`Doc vencido B ${sufixo}`);
      expect(txtB).not.toContain(`Doc vencido A ${sufixo}`);
      expect(semHora(r.body)).not.toEqual(semHora(doRhB));
    });
    it('?tenant_id=B no modo atuação em A não vaza B (RLS)', async () => {
      const ta = await tokenDe(A.tenantId);
      // Comportamento determinístico por rota: as que FILTRAM pelo tenant_id da query devolvem 200 [] (o RLS de A
      // esconde B); positions IGNORA a query para não-admin e devolve 200 com os dados de A.
      const esperado: Array<[string, string, 'vazio' | 'A']> = [
        ['/employees', 'employee', 'vazio'], ['/epis', 'epi', 'vazio'], ['/documents', 'document', 'vazio'], ['/positions', 'position', 'A'],
      ];
      for (const [path, chave, forma] of esperado) {
        const r = await get(ta, `${path}?tenant_id=${B.tenantId}`);
        expect({ path, status: r.status }).toEqual({ path, status: 200 });
        expect(Array.isArray(r.body)).toBe(true);
        const txt = JSON.stringify(r.body);
        expect(txt).not.toContain(fx.B[chave]);
        expect(txt).not.toContain(B.tenantId);
        if (forma === 'vazio') expect({ path, body: r.body }).toEqual({ path, body: [] });
        else expect(txt).toContain(fx.A[chave]);
      }
    });
    it('leitura por id de linha de B a partir de A => não 200, sem vazar', async () => {
      const ta = await tokenDe(A.tenantId);
      for (const path of [`/positions/${fx.B.position}`, `/company-units/${fx.B.unit}`, `/cipa/committees/${fx.B.committee}`, `/fire-brigade/members/${fx.B.brigade}`]) {
        const r = await get(ta, path);
        expect([403, 404]).toContain(r.status);
        expect(JSON.stringify(r.body)).not.toContain(B.tenantId);
      }
    });
    it('GET /tenants/me devolve a casca da empresa atuada (A)', async () => {
      const r = await get(await tokenDe(A.tenantId), '/tenants/me');
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(A.tenantId);
    });
  });

  describe('uso do token de atuação — escrita', () => {
    it('POST /positions com tenant_id de B no corpo grava em A, nunca em B', async () => {
      const ta = await tokenDe(A.tenantId);
      const nome = `Cargo atuacao ${sufixo}`;
      const r = await http().post('/positions').set(auth(ta)).send({ name: nome, tenant_id: B.tenantId });
      expect(r.status).toBe(201);
      const rows = (await db.client.query('SELECT tenant_id FROM positions WHERE name=$1', [nome])).rows;
      expect(rows).toEqual([{ tenant_id: A.tenantId }]);
    });
    it('POST /company-units com tenant_id de B no corpo grava em A, nunca em B', async () => {
      const ta = await tokenDe(A.tenantId);
      const nome = `Filial atuacao ${sufixo}`;
      const r = await http().post('/company-units').set(auth(ta)).send({
        name: nome, cnpj: gerarCnpj(), address_street: 'Rua Y', address_city: 'Cidade', address_state: 'SP', address_zip: '01001000',
        tenant_id: B.tenantId,
      });
      expect(r.status).toBe(201);
      const rows = (await db.client.query('SELECT tenant_id FROM company_units WHERE name=$1', [nome])).rows;
      expect(rows).toEqual([{ tenant_id: A.tenantId }]);
    });
    it('POST /cipa/committees com responsável do RH de A grava em A', async () => {
      const ta = await tokenDe(A.tenantId);
      const r = await http().post('/cipa/committees').set(auth(ta)).send({
        company_unit_id: fx.A.unit, ano: 2027, data_inicio: '2027-01-01', data_termino: '2027-12-31', responsavel_user_id: A.userId,
      });
      expect(r.status).toBe(201);
      const rows = (await db.client.query('SELECT tenant_id FROM cipa_committees WHERE id=$1', [r.body.id])).rows;
      expect(rows).toEqual([{ tenant_id: A.tenantId }]);
    });
    it('POST /cipa/committees com unidade de B a partir de A é recusado (sem 500, sem gravar)', async () => {
      const ta = await tokenDe(A.tenantId);
      const r = await http().post('/cipa/committees').set(auth(ta)).send({
        company_unit_id: fx.B.unit, ano: 2028, data_inicio: '2028-01-01', data_termino: '2028-12-31', responsavel_user_id: A.userId,
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      const n = (await db.client.query('SELECT count(*)::int AS n FROM cipa_committees WHERE ano=2028 AND tenant_id = ANY($1)', [[A.tenantId, B.tenantId]])).rows[0].n;
      expect(n).toBe(0);
    });
    it('PATCH /positions/:id de B a partir de A não altera B', async () => {
      const ta = await tokenDe(A.tenantId);
      const r = await http().patch(`/positions/${fx.B.position}`).set(auth(ta)).send({ name: 'Invasao' });
      expect([403, 404]).toContain(r.status);
      const row = (await db.client.query('SELECT name FROM positions WHERE id=$1', [fx.B.position])).rows[0];
      expect(row.name).toBe(`Cargo B ${sufixo}`);
    });
    it('upload de documento no modo atuação grava em A e NÃO chama o indexador (Ruling 11); RH de A chama', async () => {
      const ta = await tokenDe(A.tenantId);
      const pdf = Buffer.from('%PDF-1.4 conteudo de teste', 'utf-8');
      indexer.extractAndEmbed.mockClear();
      const r = await http().post('/documents').set(auth(ta))
        .field('category', 'pgr').field('title', `PGR atuacao ${sufixo}`).field('tenant_id', B.tenantId)
        .attach('file', pdf, { filename: 'pgr.pdf', contentType: 'application/pdf' });
      // tenant_id no corpo é rejeitado pelo whitelist OU ignorado; em nenhum caso grava em B.
      if (r.status === 400) {
        const r2b = await http().post('/documents').set(auth(ta))
          .field('category', 'pgr').field('title', `PGR atuacao ${sufixo}`)
          .attach('file', pdf, { filename: 'pgr.pdf', contentType: 'application/pdf' });
        expect(r2b.status).toBe(201);
      } else {
        expect(r.status).toBe(201);
      }
      expect(indexer.extractAndEmbed).not.toHaveBeenCalled();
      const rows = (await db.client.query('SELECT tenant_id, uploaded_by_user_id, uploaded_by_role, file_key FROM documents WHERE title=$1', [`PGR atuacao ${sufixo}`])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].tenant_id).toBe(A.tenantId);
      expect(rows[0].uploaded_by_user_id).toBe(socio.userId);
      expect(rows[0].file_key.startsWith(`tenants/${A.tenantId}/`)).toBe(true);
      // controle: fora do modo atuação o indexador É chamado (prova que o mock está ligado)
      const rh = await http().post('/documents').set(auth(tEmpA))
        .field('category', 'pgr').field('title', `PGR rh ${sufixo}`)
        .attach('file', pdf, { filename: 'pgr.pdf', contentType: 'application/pdf' });
      expect(rh.status).toBe(201);
      expect(indexer.extractAndEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('uso do token de atuação — rotas negadas e revalidação', () => {
    it.each([
      ['GET', '/subscriptions/me'],
      ['GET', '/tenant-technicians/minha-empresa'],
      ['POST', '/assistant/normative-query'],
      ['PATCH', '/tenants/me'],
      ['POST', '/pente-fino/run'],
      ['GET', '/visits'],
      ['GET', '/esocial/events'],
      ['GET', '/esocial/certificates'],
      ['POST', '/employees/documents'],
      ['POST', '/documents/classify-batch'],
      ['POST', '/auth/change-password'],
      ['GET', '/atuacao/clientes'],
      ['POST', '/atuacao/clientes'],
    ])('%s %s => 403 ACTING_ROUTE_DENIED', async (verbo, path) => {
      const t = await tokenDe(A.tenantId);
      const req = (http() as any)[verbo.toLowerCase()](path).set(auth(t));
      const r = verbo === 'GET' ? await req : await req.send({ name: 'X' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_ROUTE_DENIED');
    });
    it('token de atuação não emite outro token', async () => {
      const t = await tokenDe(A.tenantId);
      const r = await atuar(t, B.tenantId);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_ROUTE_DENIED');
    });
    it('vínculo com técnico criado DEPOIS derruba o token já emitido', async () => {
      const D = await novoTenant(`D ${sufixo}`);
      const t = await tokenDe(D.tenantId);
      expect((await get(t, '/employees')).status).toBe(200);
      const tec = (await db.client.query('SELECT id FROM technicians WHERE user_id=$1', [tecnico.userId])).rows[0].id;
      await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [D.tenantId, tec]);
      const r = await get(t, '/employees');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it('vínculo com PARCEIRO criado DEPOIS derruba o token já emitido', async () => {
      const Q = await novoTenant(`Q ${sufixo}`);
      const t = await tokenDe(Q.tenantId);
      expect((await get(t, '/employees')).status).toBe(200);
      await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1,$2)', [Q.tenantId, partnerId]);
      const r = await get(t, '/employees');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
    });
    it('revogar empresas.atuar derruba o token já emitido', async () => {
      const t = await tokenDe(A.tenantId);
      await db.client.query("DELETE FROM socio_permissions WHERE user_id=$1 AND permission='empresas.atuar'", [socio.userId]);
      try {
        const r = await get(t, '/employees');
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ACTING_NOT_ALLOWED');
      } finally {
        await db.grantSocioPermission(socio.userId, 'empresas.atuar');
      }
      expect((await get(t, '/employees')).status).toBe(200);
    });
    it('sócia desativada derruba o token já emitido', async () => {
      const t = await tokenDe(A.tenantId);
      await db.client.query("UPDATE users SET status='inativo' WHERE id=$1", [socio.userId]);
      try {
        expect((await get(t, '/employees')).status).toBe(403);
      } finally {
        await db.client.query("UPDATE users SET status='ativo' WHERE id=$1", [socio.userId]);
      }
    });
    it('auditoria grava a sócia como ator, com o tenant atuado', async () => {
      const t = await tokenDe(A.tenantId);
      await http().post('/employees').set(auth(t)).send({}); // 400 esperado; a auditoria registra mesmo assim
      await new Promise((r) => setTimeout(r, 500));
      const rows = (await db.client.query(
        "SELECT actor_role, actor_tenant_id, detail, status_code FROM audit_log WHERE actor_user_id=$1 AND detail='atuando_como_empresa' AND path='/employees' AND action <> 'atuacao.acesso' ORDER BY occurred_at DESC LIMIT 1",
        [socio.userId],
      )).rows;
      expect(rows[0]).toMatchObject({ actor_role: 'socio', actor_tenant_id: A.tenantId, status_code: 400 });
      // negação gerada AQUI (o caso passa isolado com -t): rota fora da lista => atuacao.negada
      const antes = new Date();
      const neg = await get(t, '/visits');
      expect(neg.body.code).toBe('ACTING_ROUTE_DENIED');
      await new Promise((r) => setTimeout(r, 500));
      const negadas = (await db.client.query(
        "SELECT actor_role, resource_id::text AS resource_id, path, status_code, detail FROM audit_log WHERE actor_user_id=$1 AND action='atuacao.negada' AND path='/visits' AND occurred_at >= $2 ORDER BY occurred_at DESC",
        [socio.userId, antes])).rows;
      expect(negadas.length).toBeGreaterThanOrEqual(1); // mesmo relógio (mesmo host) para node e Postgres
      expect(negadas[0]).toMatchObject({ actor_role: 'socio', resource_id: A.tenantId, status_code: 403, detail: 'rota fora do modo atuação' });
    });
  });

  describe('auditoria de LEITURAS no modo atuação (Ruling 20)', () => {
    it('GET /employees?q=... grava atuacao.acesso (sócia, tenant atuado, path sem query); GET /tenants/me não grava', async () => {
      const t = await tokenDe(A.tenantId);
      // zera as leituras auditadas pelos testes anteriores (o filtro abaixo não depende de relógio)
      await db.client.query("DELETE FROM audit_log WHERE actor_user_id=$1 AND action='atuacao.acesso'", [socio.userId]);
      try {
        expect((await get(t, `/employees?q=sigilo${sufixo}`)).status).toBe(200);
        expect((await get(t, '/tenants/me')).status).toBe(200);
        await new Promise((r) => setTimeout(r, 500));
        const rows = (await db.client.query(
          "SELECT actor_role, actor_tenant_id, method, path, status_code, detail FROM audit_log WHERE actor_user_id=$1 AND action='atuacao.acesso' ORDER BY occurred_at",
          [socio.userId])).rows;
        expect(rows).toEqual([
          { actor_role: 'socio', actor_tenant_id: A.tenantId, method: 'GET', path: '/employees', status_code: 200, detail: 'atuando_como_empresa' },
        ]);
        // nenhuma linha guarda a query string (pode conter nome/CPF buscado)
        const comQuery = (await db.client.query(
          "SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1 AND path LIKE $2", [socio.userId, `%sigilo${sufixo}%`])).rows[0].n;
        expect(comQuery).toBe(0);
      } finally {
        await db.client.query("DELETE FROM audit_log WHERE actor_user_id=$1 AND action='atuacao.acesso'", [socio.userId]);
      }
    });
  });

  describe('SubscriptionStatusGuard no modo atuação', () => {
    it("empresa atuada com assinatura 'cancelled' => 403 SUBSCRIPTION_INACTIVE (comportamento atual, documentado)", async () => {
      const E = await novoTenant(`Cancelada ${sufixo}`);
      const plano = (await db.client.query("SELECT id FROM plans WHERE audience='empresa' ORDER BY id LIMIT 1")).rows[0].id;
      await db.client.query("INSERT INTO subscriptions (plan_id, tenant_id, status) VALUES ($1,$2,'cancelled')", [plano, E.tenantId]);
      const emissao = await atuar(tSocio, E.tenantId);
      expect(emissao.status).toBe(201); // a emissão (rota da sócia) não olha assinatura
      const r = await get(emissao.body.access_token, '/employees');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('SUBSCRIPTION_INACTIVE');
    });
  });

  describe('cadastro de empresa pela sócia', () => {
    const body = (o: object = {}) => ({
      company_name: `Nova ${sufixo}`, cnpj: gerarCnpj(), full_name: 'RH Novo',
      email: `rh-${randomUUID().slice(0, 8)}@teste.montese.local`, password: 'Temporaria1', ...o,
    });
    const criar = (t: string, b: object) => http().post('/atuacao/clientes').set(auth(t)).send(b);

    it('cria empresa (trial), login do RH exige troca, troca libera, novo token sem mcp; sócia atua nela', async () => {
      const b = body();
      const r = await criar(tSocio, b);
      expect(r.status).toBe(201);
      expect(JSON.stringify(r.body)).not.toContain('Temporaria1');
      criados.push(r.body.tenant_id);
      const t = (await db.client.query('SELECT plan, status FROM tenants WHERE id=$1', [r.body.tenant_id])).rows[0];
      expect(t).toEqual({ plan: 'trial', status: 'ativo' });
      const aud = (await db.client.query(
        "SELECT detail FROM audit_log WHERE actor_user_id=$1 AND action='empresa.criada_por_socio' AND resource_id::text=$2", [socio.userId, r.body.tenant_id])).rows;
      expect(aud).toHaveLength(1);
      expect(JSON.stringify(aud)).not.toContain('Temporaria1');
      expect(JSON.stringify(aud)).not.toContain(b.email);

      const lg = await http().post('/auth/login').send({ email: b.email, password: b.password });
      expect(lg.status).toBe(201);
      expect(lg.body.user.mustChangePassword).toBe(true);
      expect(decode(lg.body.access_token).mcp).toBe(true);
      const bloqueada = await get(lg.body.access_token, '/employees');
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await get(lg.body.access_token, '/auth/me')).status).toBe(200);

      const tr = await http().post('/auth/change-password').set(auth(lg.body.access_token))
        .send({ current_password: 'Temporaria1', new_password: 'SenhaDefinitiva9' });
      expect(tr.status).toBe(201);
      expect(decode(tr.body.access_token).mcp).toBeUndefined();
      expect((await get(tr.body.access_token, '/employees')).status).toBe(200);
      const outra = await http().post('/auth/login').send({ email: b.email, password: 'SenhaDefinitiva9' });
      expect(outra.body.user.mustChangePassword).toBe(false);
      expect(decode(outra.body.access_token).mcp).toBeUndefined();
      expect((await db.client.query('SELECT is_montese_tenant($1) AS ok', [r.body.tenant_id])).rows[0].ok).toBe(true);

      // empresa trial (sem assinatura) criada pela sócia opera normalmente no modo atuação
      const ta = await tokenDe(r.body.tenant_id);
      expect((await get(ta, '/employees')).status).toBe(200);
      expect((await get(ta, '/dashboard/summary')).status).toBe(200);
    });
    it('recusa sem empresas.criar, papel errado e campos extras', async () => {
      expect((await criar(tSemPerm, body())).status).toBe(403);
      expect((await criar(tEmpA, body())).status).toBe(403);
      expect((await criar(tSocio, body({ role: 'admin' }))).status).toBe(400);
      expect((await criar(tSocio, body({ cnpj: '11.222.333/0001-82' }))).status).toBe(400); // DV errado
      expect((await criar(tSocio, body({ password: 'curta' }))).status).toBe(400);
    });
    it('e-mail duplicado => 409; CNPJ duplicado => 409', async () => {
      const b = body();
      const r1 = await criar(tSocio, b);
      expect(r1.status).toBe(201);
      criados.push(r1.body.tenant_id);
      expect((await criar(tSocio, { ...b, cnpj: gerarCnpj() })).status).toBe(409);
      const r3 = await criar(tSocio, { ...body(), cnpj: b.cnpj });
      if (r3.status === 201) criados.push(r3.body.tenant_id);
      expect(r3.status).toBe(409);
    });
  });
});
