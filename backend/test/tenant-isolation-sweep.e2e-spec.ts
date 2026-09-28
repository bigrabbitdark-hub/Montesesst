import { Client } from 'pg';
import { TestDb, TestTenantFixture } from './db-test-helper';

// ITEM 008 (auditoria 2026-09-27): dezenas de rotas aceitam `tenant_id` do cliente e
// dependem 100% da RLS como única barreira — e já houve um bypass real desse padrão
// (`pente-fino`, `9af00d1`). Os specs `*-rls.e2e-spec.ts` cobrem tabelas escolhidas à
// mão; ESTA varredura é orientada pelo catálogo do Postgres, então uma tabela nova (ou
// uma policy errada numa tabela sem spec próprio) é pega sem que ninguém precise lembrar
// de escrever um teste.
//
// Sempre com a role da aplicação (montese_app, sujeita a RLS — nunca o superuser),
// somente leitura (BEGIN + set_config + SELECT count + ROLLBACK). Só CONTAGENS entram na
// mensagem de falha: nunca o conteúdo de uma linha (o banco pode ter dado real).
const APP_URL = process.env.DATABASE_URL as string;
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

// Tabelas com coluna tenant_id que, DE PROPÓSITO, não têm RLS forçada. Cada entrada
// exige um motivo escrito; começa vazia (hoje todas as tabelas com tenant_id têm FORCE).
const EXEMPT_FROM_FORCE_RLS: Record<string, string> = {};

interface Ctx {
  userId?: string;
  tenantId?: string;
  role?: string;
}
interface Offender {
  table: string;
  rows: number;
}

// `ctx = null`: nenhum set_config (a aplicação sem contexto — deve falhar fechada).
async function asApp<T>(ctx: Ctx | null, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: APP_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (ctx) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId ?? '']);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId ?? '']);
      await client.query("SELECT set_config('app.role', $1, true)", [ctx.role ?? '']);
    }
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

// Conta as linhas de cada tabela que satisfazem `predicate` (as que NÃO deveriam ser
// visíveis). Um SAVEPOINT por tabela: se a role da aplicação nem puder ler a tabela
// ("permission denied"), isso é ausência de acesso — não vazamento — e não aborta a
// transação das demais.
async function visibleForbiddenRows(client: Client, tables: string[], predicate: string, params: unknown[]): Promise<Offender[]> {
  const offenders: Offender[] = [];
  for (const table of tables) {
    await client.query('SAVEPOINT sweep');
    try {
      const res = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}" WHERE ${predicate}`, params);
      if (res.rows[0].n > 0) offenders.push({ table, rows: res.rows[0].n });
      await client.query('RELEASE SAVEPOINT sweep');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT sweep');
    }
  }
  return offenders;
}

describe('Varredura de isolamento multi-tenant — todas as tabelas com tenant_id (e2e)', () => {
  let db: TestDb;
  let superuser: Client;
  let tables: string[];
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let linkedTechnicianUserId: string;
  let unlinkedTechnicianUserId: string;
  let linkedPartnerUserId: string;
  let unlinkedPartnerUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    superuser = new Client({ connectionString: SUPERUSER_URL });
    await superuser.connect();

    const res = await superuser.query<{ table_name: string }>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        ORDER BY c.table_name`,
    );
    tables = res.rows.map((r) => r.table_name);

    tenantA = await db.createTenantWithUser('Empresa Varredura A');
    tenantB = await db.createTenantWithUser('Empresa Varredura B');
    linkedTechnicianUserId = (await db.createUserWithRole('tecnico', 'Tecnico Varredura Vinculado A')).userId;
    unlinkedTechnicianUserId = (await db.createUserWithRole('tecnico', 'Tecnico Varredura Sem Vinculo')).userId;
    linkedPartnerUserId = (await db.createUserWithRole('parceiro', 'Parceiro Varredura Vinculado B')).userId;
    unlinkedPartnerUserId = (await db.createUserWithRole('parceiro', 'Parceiro Varredura Sem Vinculo')).userId;

    for (const userId of [linkedTechnicianUserId, unlinkedTechnicianUserId]) {
      await superuser.query('INSERT INTO technicians (user_id) VALUES ($1)', [userId]);
    }
    await superuser.query(
      `INSERT INTO tenant_technicians (tenant_id, technician_id) SELECT $1, id FROM technicians WHERE user_id = $2`,
      [tenantA.tenantId, linkedTechnicianUserId],
    );
    for (const userId of [linkedPartnerUserId, unlinkedPartnerUserId]) {
      await superuser.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'SC')`, [userId]);
    }
    await superuser.query(
      `INSERT INTO tenant_partners (tenant_id, partner_id) SELECT $1, id FROM partners WHERE user_id = $2`,
      [tenantB.tenantId, linkedPartnerUserId],
    );
  });

  afterAll(async () => {
    await superuser.end();
    await db.cleanup();
    await db.disconnect();
  });

  it('a varredura enxerga o schema (descobre as tabelas com tenant_id) — sem isso, zero vazamento seria vazio', () => {
    expect(tables.length).toBeGreaterThan(20);
    expect(tables).toEqual(expect.arrayContaining(['users', 'documents', 'company_units']));
  });

  it('toda tabela com tenant_id tem RLS ATIVA e FORÇADA (tabela nova sem RLS reprova aqui)', async () => {
    const res = await superuser.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
      [tables],
    );
    const offenders = res.rows
      .filter((r) => !(r.relrowsecurity && r.relforcerowsecurity) && !(r.relname in EXEMPT_FROM_FORCE_RLS))
      .map((r) => ({ table: r.relname, rls: r.relrowsecurity, force: r.relforcerowsecurity }));
    expect(offenders).toEqual([]);
    expect(res.rows.length).toBe(tables.length);
  });

  it('controle positivo: o tenant A enxerga a PRÓPRIA linha em users, e o superuser confirma que há linhas do tenant B para vazar', async () => {
    const own = await asApp({ userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'empresa' }, async (client) =>
      Number((await client.query('SELECT count(*) FROM users WHERE tenant_id = $1', [tenantA.tenantId])).rows[0].count),
    );
    expect(own).toBeGreaterThanOrEqual(1);
    const foreignExists = Number(
      (await superuser.query('SELECT count(*) FROM users WHERE tenant_id = $1', [tenantB.tenantId])).rows[0].count,
    );
    expect(foreignExists).toBeGreaterThanOrEqual(1);
  });

  it(
    'EMPRESA: sob o contexto de cada tenant existente, nenhuma tabela devolve linha de OUTRO tenant',
    async () => {
      const tenants = (
        await superuser.query<{ tenant_id: string; user_id: string }>(
          `SELECT t.id AS tenant_id, u.id AS user_id
             FROM tenants t
             JOIN LATERAL (SELECT id FROM users WHERE tenant_id = t.id AND role = 'empresa' ORDER BY created_at LIMIT 1) u ON true
            ORDER BY t.created_at
            LIMIT 80`,
        )
      ).rows;
      expect(tenants.length).toBeGreaterThanOrEqual(2); // ao menos os fixtures A e B

      // Agrupado por TABELA (uma linha por tabela que vaza), não por tenant: com 30+ tenants
      // a mesma tabela apareceria dezenas de vezes e esconderia o que importa.
      const leaks = new Map<string, { tenantesAfetados: number; maxLinhasVisiveis: number; tenantDeExemplo: string }>();
      for (const t of tenants) {
        const offenders = await asApp({ userId: t.user_id, tenantId: t.tenant_id, role: 'empresa' }, (client) =>
          visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL AND tenant_id <> $1::uuid', [t.tenant_id]),
        );
        for (const o of offenders) {
          const cur = leaks.get(o.table) ?? { tenantesAfetados: 0, maxLinhasVisiveis: 0, tenantDeExemplo: t.tenant_id };
          cur.tenantesAfetados += 1;
          cur.maxLinhasVisiveis = Math.max(cur.maxLinhasVisiveis, o.rows);
          leaks.set(o.table, cur);
        }
      }
      expect([...leaks].map(([table, info]) => ({ table, ...info }))).toEqual([]);
    },
    180_000,
  );

  it('TÉCNICO vinculado só ao tenant A: nenhuma tabela devolve linha de tenant que não seja o A', async () => {
    const offenders = await asApp({ userId: linkedTechnicianUserId, role: 'tecnico' }, (client) =>
      visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL AND tenant_id <> $1::uuid', [tenantA.tenantId]),
    );
    expect(offenders).toEqual([]);
  });

  it('TÉCNICO sem nenhum vínculo: nenhuma tabela devolve linha com tenant_id', async () => {
    const offenders = await asApp({ userId: unlinkedTechnicianUserId, role: 'tecnico' }, (client) =>
      visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL', []),
    );
    expect(offenders).toEqual([]);
  });

  it('PARCEIRO vinculado só ao tenant B: nenhuma tabela devolve linha de tenant que não seja o B', async () => {
    const offenders = await asApp({ userId: linkedPartnerUserId, role: 'parceiro' }, (client) =>
      visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL AND tenant_id <> $1::uuid', [tenantB.tenantId]),
    );
    expect(offenders).toEqual([]);
  });

  it('PARCEIRO sem nenhum vínculo: nenhuma tabela devolve linha com tenant_id', async () => {
    const offenders = await asApp({ userId: unlinkedPartnerUserId, role: 'parceiro' }, (client) =>
      visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL', []),
    );
    expect(offenders).toEqual([]);
  });

  it('SEM contexto nenhum (nenhum set_config): falha fechada — nenhuma tabela devolve linha com tenant_id', async () => {
    const offenders = await asApp(null, (client) => visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL', []));
    expect(offenders).toEqual([]);
  });

  it('EMPRESA com role inventada ("superadmin") no contexto não ganha visão de outros tenants', async () => {
    const offenders = await asApp({ userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'superadmin' }, (client) =>
      visibleForbiddenRows(client, tables, 'tenant_id IS NOT NULL AND tenant_id <> $1::uuid', [tenantA.tenantId]),
    );
    expect(offenders).toEqual([]);
  });
});
