import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel D0, Task 1: carteira explícita (socio_portfolio, migration 0101) e a nova
// is_montese_tenant(): "sem vínculo com técnico/parceiro (regra da 0091) OU marcada na carteira".
// Conexão na role da aplicação (sujeita a RLS), contexto via set_config local.
type Papel = 'admin' | 'socio' | 'empresa' | 'tecnico' | 'parceiro';

async function comoPapel<T>(
  role: Papel,
  userId: string,
  fn: (c: Client) => Promise<T>,
  opts: { tenantId?: string; commit?: boolean } = {},
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.role', $3, true)",
      [userId, opts.tenantId ?? '', role],
    );
    const out = await fn(client);
    await client.query(opts.commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

// Negado = SOMENTE erro de permissão/RLS, ou rowCount 0 (RLS sem policy). Outro erro falha o teste.
const negado = (p: Promise<{ rowCount: number | null }>) =>
  p.then(
    (r) => (r.rowCount ?? 0) === 0,
    (e: Error) => /permission denied|row-level security/i.test(e.message),
  );

// Regra ANTERIOR (0091), copiada literalmente: base do snapshot antes/depois.
const REGRA_ANTIGA = (col: string) =>
  `(NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = ${col})
     AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = ${col}))`;

const MIGRATION = join(__dirname, '..', 'db', 'migrations', '0101_socio_portfolio.sql');

describe('socio_portfolio — carteira explícita e is_montese_tenant (e2e)', () => {
  let db: TestDb;
  let admin: TestUserFixture;
  let socio: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let tMontese: { tenantId: string; userId: string };
  let tTec: { tenantId: string; userId: string };
  let tPar: { tenantId: string; userId: string };
  let tInativo: { tenantId: string; userId: string };
  const docs: Record<string, string> = {};
  const inspecoes: Record<string, string> = {};

  const comoSocio = <T>(fn: (c: Client) => Promise<T>) => comoPapel('socio', socio.userId, fn);
  const comoAdmin = <T>(fn: (c: Client) => Promise<T>, commit = false) => comoPapel('admin', admin.userId, fn, { commit });

  const marcar = (tenantId: string) =>
    comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id, added_by) VALUES ($1, $2)', [tenantId, admin.userId]), true);
  const desmarcar = (tenantId: string) =>
    comoAdmin((c) => c.query('DELETE FROM socio_portfolio WHERE tenant_id = $1', [tenantId]), true);
  const marcadaNoBanco = async (tenantId: string) =>
    (await db.client.query('SELECT 1 FROM socio_portfolio WHERE tenant_id = $1', [tenantId])).rowCount === 1;

  // O que o sócio enxerga de uma empresa pelas policies existentes (Z / 0092 / 0096).
  const visaoSocio = (tenantId: string) =>
    comoSocio(async (c) => ({
      tenant: (await c.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId])).rowCount,
      documentos: (await c.query('SELECT 1 FROM documents WHERE tenant_id = $1', [tenantId])).rowCount,
      funcionarios: (await c.query('SELECT 1 FROM employees WHERE tenant_id = $1', [tenantId])).rowCount,
      // inspections não tem policy de sócio (só admin/empresa/técnico/parceiro vinculados): a marcação NÃO amplia.
      inspecoes: (await c.query('SELECT 1 FROM inspections WHERE tenant_id = $1', [tenantId])).rowCount,
      funcao: (await c.query('SELECT is_montese_tenant($1) AS m', [tenantId])).rows[0].m,
    }));
  const VISIVEL = { tenant: 1, documentos: 1, funcionarios: 1, inspecoes: 0, funcao: true };
  const INVISIVEL = { tenant: 0, documentos: 0, funcionarios: 0, inspecoes: 0, funcao: false };

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    admin = await db.createUserWithRole('admin', 'Admin Carteira');
    socio = await db.createUserWithRole('socio', 'Socio Carteira');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Carteira');
    parceiroUser = await db.createUserWithRole('parceiro', 'Par Carteira');
    tMontese = await db.createTenantWithUser('Cliente Montese Carteira');
    tTec = await db.createTenantWithUser('Cliente Tecnico Carteira');
    tPar = await db.createTenantWithUser('Cliente Parceiro Carteira');
    tInativo = await db.createTenantWithUser('Cliente Vinculo Inativo Carteira');

    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    const par = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'TESTE') RETURNING id", [
      parceiroUser.userId,
    ]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tTec.tenantId, tec.rows[0].id]);
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tPar.tenantId, par.rows[0].id]);
    // Vínculo inativo continua contando como vínculo (regra da 0091: qualquer status).
    await db.client.query("INSERT INTO tenant_technicians (tenant_id, technician_id, status) VALUES ($1, $2, 'inativo')", [
      tInativo.tenantId, tec.rows[0].id,
    ]);

    for (const t of [tMontese, tTec, tPar, tInativo]) {
      docs[t.tenantId] = await db.insertRawRow('documents', {
        tenant_id: t.tenantId,
        category: 'pgr',
        title: 'TESTE Doc carteira',
        file_key: `carteira/${Math.random()}`,
        file_name: 'a.pdf',
        mime_type: 'application/pdf',
        size_bytes: 10,
        uploaded_by_user_id: t.userId,
        uploaded_by_role: 'empresa',
      });
      inspecoes[t.tenantId] = await db.insertRawRow('inspections', {
        tenant_id: t.tenantId,
        technician_user_id: tecnicoUser.userId,
        visited_at: '2026-01-10',
      });
    }
  });

  afterAll(async () => {
    try {
      await db.cleanup(); // tenants em cascata levam socio_portfolio
    } finally {
      await db.disconnect();
    }
  });

  // --- Estrutura ---
  it('socio_portfolio tem RLS habilitado e FORCE', async () => {
    const r = await db.client.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'socio_portfolio'");
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('única policy é a do admin (FOR ALL); nenhum outro papel tem policy', async () => {
    const r = await db.client.query(
      "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'socio_portfolio' ORDER BY policyname",
    );
    expect(r.rows.map((x: any) => [x.policyname, x.cmd])).toEqual([['socio_portfolio_admin', 'ALL']]);
    expect(r.rows[0].qual).toBe("(current_setting('app.role'::text, true) = 'admin'::text)");
    expect(r.rows[0].with_check).toBe(
      "((current_setting('app.role'::text, true) = 'admin'::text) AND ((added_by IS NULL) OR ((added_by)::text = current_setting('app.user_id'::text, true))))",
    );
  });

  it('a migration não semeia a carteira: nenhuma empresa fora das fixtures marcada', async () => {
    const r = await db.client.query('SELECT count(*)::int n FROM socio_portfolio');
    expect(r.rows[0].n).toBe(0);
  });

  // --- Snapshot: nenhuma empresa ganha/perde o status sem marcação ---
  it('snapshot: para TODA empresa, nova função = regra antiga OU marcada (e, sem marcações, idêntica à antiga)', async () => {
    const r = await db.client.query(
      `SELECT t.id, ${REGRA_ANTIGA('t.id')} AS antiga, is_montese_tenant(t.id) AS nova,
              EXISTS (SELECT 1 FROM socio_portfolio p WHERE p.tenant_id = t.id) AS marcada
         FROM tenants t`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(4);
    for (const x of r.rows) expect([x.id, x.nova]).toEqual([x.id, x.antiga || x.marcada]);
    const antes = r.rows.filter((x: any) => x.antiga).map((x: any) => x.id).sort();
    const depois = r.rows.filter((x: any) => x.nova).map((x: any) => x.id).sort();
    expect(depois).toEqual(antes);
  });

  it('snapshot como sócio (role da aplicação): tenants visíveis = exatamente os da regra antiga', async () => {
    const esperado = (await db.client.query(`SELECT id FROM tenants t WHERE ${REGRA_ANTIGA('t.id')} ORDER BY id`)).rows.map(
      (x: any) => x.id,
    );
    const visto = await comoSocio(async (c) => (await c.query('SELECT id FROM tenants ORDER BY id')).rows.map((x: any) => x.id));
    expect(visto).toEqual(esperado);
    expect(visto).toContain(tMontese.tenantId);
    expect(visto).not.toContain(tTec.tenantId);
    expect(visto).not.toContain(tPar.tenantId);
    expect(visto).not.toContain(tInativo.tenantId);
  });

  // --- Marcação explícita ---
  it('cliente sem vínculo continua Montese (carteira automática)', async () => {
    expect(await visaoSocio(tMontese.tenantId)).toEqual(VISIVEL);
  });

  it.each([
    ['técnico', () => tTec],
    ['parceiro', () => tPar],
    ['técnico inativo', () => tInativo],
  ])('empresa com vínculo de %s: invisível sem marcação; visível após marcar; invisível após desmarcar', async (_n, get) => {
    const t = get();
    expect(await visaoSocio(t.tenantId)).toEqual(INVISIVEL);
    expect((await marcar(t.tenantId)).rowCount).toBe(1);
    try {
      expect(await visaoSocio(t.tenantId)).toEqual(VISIVEL);
      const doc = await comoSocio(async (c) => (await c.query('SELECT id FROM documents WHERE id = $1', [docs[t.tenantId]])).rowCount);
      expect(doc).toBe(1);
    } finally {
      expect((await desmarcar(t.tenantId)).rowCount).toBe(1);
    }
    expect(await visaoSocio(t.tenantId)).toEqual(INVISIVEL);
  });

  it('marcar uma empresa não afeta as demais', async () => {
    await marcar(tTec.tenantId);
    try {
      expect(await visaoSocio(tPar.tenantId)).toEqual(INVISIVEL);
      expect(await visaoSocio(tInativo.tenantId)).toEqual(INVISIVEL);
    } finally {
      await desmarcar(tTec.tenantId);
    }
  });

  it('marcar não tira acesso de quem já tinha: técnico, parceiro e empresa continuam vendo tenant, documento e inspeção', async () => {
    const tec = await db.client.query('SELECT id FROM technicians WHERE user_id = $1', [tecnicoUser.userId]);
    expect(tec.rowCount).toBe(1);
    const ver = (role: Papel, uid: string, t: { tenantId: string }, tenantCtx = '') =>
      comoPapel(role, uid, async (c) => ({
        tenant: (await c.query('SELECT 1 FROM tenants WHERE id = $1', [t.tenantId])).rowCount,
        documento: (await c.query('SELECT 1 FROM documents WHERE id = $1', [docs[t.tenantId]])).rowCount,
        inspecao: (await c.query('SELECT 1 FROM inspections WHERE id = $1', [inspecoes[t.tenantId]])).rowCount,
      }), { tenantId: tenantCtx });
    const TUDO = { tenant: 1, documento: 1, inspecao: 1 };
    const antes = {
      tecnico: await ver('tecnico', tecnicoUser.userId, tTec),
      parceiro: await ver('parceiro', parceiroUser.userId, tPar),
      empresaTec: await ver('empresa', tTec.userId, tTec, tTec.tenantId),
      empresaPar: await ver('empresa', tPar.userId, tPar, tPar.tenantId),
    };
    expect(antes).toEqual({ tecnico: TUDO, parceiro: TUDO, empresaTec: TUDO, empresaPar: TUDO });
    await marcar(tTec.tenantId);
    await marcar(tPar.tenantId);
    try {
      expect({
        tecnico: await ver('tecnico', tecnicoUser.userId, tTec),
        parceiro: await ver('parceiro', parceiroUser.userId, tPar),
        empresaTec: await ver('empresa', tTec.userId, tTec, tTec.tenantId),
        empresaPar: await ver('empresa', tPar.userId, tPar, tPar.tenantId),
      }).toEqual(antes);
      // e a marcação não dá ao técnico/parceiro acesso ao tenant do outro
      expect((await ver('tecnico', tecnicoUser.userId, tPar)).tenant).toBe(0);
      expect((await ver('parceiro', parceiroUser.userId, tTec)).tenant).toBe(0);
    } finally {
      await desmarcar(tTec.tenantId);
      await desmarcar(tPar.tenantId);
    }
  });

  it('is_montese_tenant(NULL) e de uuid inexistente: true, herdado da regra antiga (inalterado)', async () => {
    const r = await db.client.query(
      `SELECT is_montese_tenant(NULL) AS nulo, ${REGRA_ANTIGA('NULL::uuid')} AS nulo_antiga,
              is_montese_tenant(gen_random_uuid()) AS inexistente`,
    );
    expect(r.rows[0]).toEqual({ nulo: true, nulo_antiga: true, inexistente: true });
  });

  // --- RLS de socio_portfolio por papel ---
  describe('acesso a socio_portfolio por papel', () => {
    beforeAll(async () => {
      await marcar(tTec.tenantId);
    });
    afterAll(async () => {
      await desmarcar(tTec.tenantId);
    });

    const papeis: Array<[Papel, () => string, () => string]> = [
      ['socio', () => socio.userId, () => ''],
      ['empresa', () => tTec.userId, () => tTec.tenantId],
      ['tecnico', () => tecnicoUser.userId, () => ''],
      ['parceiro', () => parceiroUser.userId, () => ''],
    ];

    it.each(papeis)('%s não lê socio_portfolio (nem da própria empresa)', async (role, uid, tid) => {
      const n = await comoPapel(role, uid(), async (c) => (await c.query('SELECT 1 FROM socio_portfolio')).rowCount, {
        tenantId: tid(),
      });
      expect(n).toBe(0);
    });

    it.each(papeis)('%s não insere em socio_portfolio', async (role, uid, tid) => {
      const ok = await negado(
        comoPapel(role, uid(), (c) => c.query('INSERT INTO socio_portfolio (tenant_id) VALUES ($1)', [tPar.tenantId]), {
          tenantId: tid(),
        }),
      );
      expect(ok).toBe(true);
      expect(await marcadaNoBanco(tPar.tenantId)).toBe(false);
    });

    it.each(papeis)('%s não apaga nem altera socio_portfolio', async (role, uid, tid) => {
      expect(
        await negado(comoPapel(role, uid(), (c) => c.query('DELETE FROM socio_portfolio WHERE tenant_id = $1', [tTec.tenantId]), { tenantId: tid(), commit: true })),
      ).toBe(true);
      expect(
        await negado(
          comoPapel(role, uid(), (c) => c.query("UPDATE socio_portfolio SET note = 'x' WHERE tenant_id = $1", [tTec.tenantId]), {
            tenantId: tid(),
            commit: true,
          }),
        ),
      ).toBe(true);
      const r = await db.client.query('SELECT note FROM socio_portfolio WHERE tenant_id = $1', [tTec.tenantId]);
      expect(r.rows).toEqual([{ note: null }]);
    });

    it('sem papel (contexto vazio) não lê socio_portfolio', async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        expect((await client.query('SELECT 1 FROM socio_portfolio')).rowCount).toBe(0);
      } finally {
        await client.end();
      }
    });

    it('sem papel (contexto vazio) não insere em socio_portfolio', async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        expect(await negado(client.query('INSERT INTO socio_portfolio (tenant_id) VALUES ($1)', [tPar.tenantId]))).toBe(true);
      } finally {
        await client.end();
      }
      expect(await marcadaNoBanco(tPar.tenantId)).toBe(false);
    });

    it('admin não registra OUTRO usuário como autor (added_by forjado ⇒ RLS); o próprio ou NULL passam', async () => {
      await expect(
        comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id, added_by) VALUES ($1, $2)', [tPar.tenantId, socio.userId])),
      ).rejects.toThrow(/row-level security/);
      await expect(
        comoAdmin((c) => c.query('UPDATE socio_portfolio SET added_by = $2 WHERE tenant_id = $1', [tTec.tenantId, socio.userId])),
      ).rejects.toThrow(/row-level security/);
      expect(
        (await comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id, added_by) VALUES ($1, $2)', [tPar.tenantId, admin.userId]))).rowCount,
      ).toBe(1);
      expect(await marcadaNoBanco(tPar.tenantId)).toBe(false); // ROLLBACK do comoPapel
    });

    it('admin lê, insere, altera a nota e apaga', async () => {
      await comoAdmin(async (c) => {
        expect((await c.query('SELECT tenant_id FROM socio_portfolio WHERE tenant_id = $1', [tTec.tenantId])).rowCount).toBe(1);
        expect((await c.query("INSERT INTO socio_portfolio (tenant_id, note) VALUES ($1, 'TESTE')", [tPar.tenantId])).rowCount).toBe(1);
        expect((await c.query("UPDATE socio_portfolio SET note = 'TESTE 2' WHERE tenant_id = $1", [tPar.tenantId])).rowCount).toBe(1);
        expect((await c.query('DELETE FROM socio_portfolio WHERE tenant_id = $1', [tPar.tenantId])).rowCount).toBe(1);
      });
    });
  });

  // --- Integridade ---
  it('tenant_id é imutável (trigger), inclusive para o admin', async () => {
    await marcar(tTec.tenantId);
    try {
      await expect(
        comoAdmin((c) => c.query('UPDATE socio_portfolio SET tenant_id = $2 WHERE tenant_id = $1', [tTec.tenantId, tPar.tenantId])),
      ).rejects.toThrow(/imutável/);
      await expect(
        db.client.query('UPDATE socio_portfolio SET tenant_id = $2 WHERE tenant_id = $1', [tTec.tenantId, tPar.tenantId]),
      ).rejects.toThrow(/imutável/);
      const trg = await db.client.query(
        "SELECT tgname FROM pg_trigger WHERE tgrelid = 'socio_portfolio'::regclass AND NOT tgisinternal ORDER BY tgname",
      );
      expect(trg.rows.map((x: any) => x.tgname)).toEqual(['trg_a_socio_portfolio_immutable_tenant']);
    } finally {
      await desmarcar(tTec.tenantId);
    }
  });

  it('nota limitada a 500 caracteres; empresa inexistente recusada (FK)', async () => {
    await expect(
      comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id, note) VALUES ($1, $2)', [tTec.tenantId, 'x'.repeat(501)])),
    ).rejects.toThrow(/check constraint/);
    expect(
      (await comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id, note) VALUES ($1, $2)', [tTec.tenantId, 'x'.repeat(500)])))
        .rowCount,
    ).toBe(1);
    await expect(
      comoAdmin((c) => c.query('INSERT INTO socio_portfolio (tenant_id) VALUES (gen_random_uuid())')),
    ).rejects.toThrow(/foreign key/);
  });

  it('ON DELETE CASCADE no tenant e SET NULL em added_by', async () => {
    const extra = await db.createTenantWithUser('Cliente Cascata Carteira');
    const outroAdmin = await db.createUserWithRole('admin', 'Admin Cascata Carteira');
    await comoPapel('admin', outroAdmin.userId, (c) =>
      c.query('INSERT INTO socio_portfolio (tenant_id, added_by) VALUES ($1, $2)', [extra.tenantId, outroAdmin.userId]), { commit: true },
    );
    await db.client.query('DELETE FROM users WHERE id = $1', [outroAdmin.userId]);
    const r = await db.client.query('SELECT added_by, added_at IS NOT NULL AS tem_data FROM socio_portfolio WHERE tenant_id = $1', [
      extra.tenantId,
    ]);
    expect(r.rows).toEqual([{ added_by: null, tem_data: true }]);
    await db.client.query('DELETE FROM tenants WHERE id = $1', [extra.tenantId]);
    expect(await marcadaNoBanco(extra.tenantId)).toBe(false);
  });

  // --- Função ---
  it('is_montese_tenant: mesma assinatura, dono, SECURITY DEFINER, search_path, STABLE e EXECUTE', async () => {
    const r = await db.client.query(
      `SELECT p.proowner::regrole::text AS dono, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text[] AS acl,
              pg_get_function_identity_arguments(p.oid) AS args, p.prorettype::regtype::text AS ret, l.lanname
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.proname = 'is_montese_tenant'`,
    );
    expect(r.rows).toHaveLength(1);
    const f = r.rows[0];
    expect(f).toMatchObject({ dono: 'montese_auth_bypass', prosecdef: true, provolatile: 's', args: 'p_tenant_id uuid', ret: 'boolean', lanname: 'sql' });
    expect(f.proconfig).toEqual(['search_path=public, pg_temp']);
    expect([...f.acl].sort()).toEqual(['montese_app=X/montese_auth_bypass', 'montese_auth_bypass=X/montese_auth_bypass']);
    const pub = await db.client.query("SELECT has_function_privilege('public', 'is_montese_tenant(uuid)', 'EXECUTE') AS x");
    expect(pub.rows[0].x).toBe(false);
  });

  it('dono da função lê socio_portfolio; app tem SELECT/INSERT/UPDATE/DELETE', async () => {
    const r = await db.client.query(
      `SELECT has_table_privilege('montese_auth_bypass', 'socio_portfolio', 'SELECT') AS bypass_sel,
              has_table_privilege('montese_app', 'socio_portfolio', 'SELECT,INSERT,UPDATE,DELETE') AS app`,
    );
    expect(r.rows[0]).toEqual({ bypass_sel: true, app: true });
  });

  it('corpo da função: regra antiga literal OU socio_portfolio', async () => {
    const r = await db.client.query("SELECT prosrc FROM pg_proc WHERE proname = 'is_montese_tenant'");
    const src = (r.rows[0].prosrc as string).replace(/\s+/g, ' ');
    expect(src).toContain('NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = p_tenant_id) AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = p_tenant_id)');
    expect(src).toContain('EXISTS (SELECT 1 FROM socio_portfolio WHERE tenant_id = p_tenant_id)');
  });

  it('cabeçalho da migration traz o ROLLBACK (função anterior literal + DROP TABLE)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const cabecalho = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
    expect(cabecalho).toMatch(/ROLLBACK/);
    expect(cabecalho).toMatch(/CREATE OR REPLACE FUNCTION is_montese_tenant\(p_tenant_id UUID\)/);
    expect(cabecalho).toMatch(/DROP TABLE socio_portfolio/);
    expect(cabecalho).toMatch(/DELETE FROM _migrations WHERE name = '0101_socio_portfolio.sql'/);
  });
});
