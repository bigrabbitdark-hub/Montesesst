import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb, TestTenantFixture } from './db-test-helper';

// ITEM 009 (auditoria 2026-09-27): `tenants` era a única tabela sem RLS. Prova,
// no nível do Postgres e com a mesma role da aplicação (montese_app, sujeita a
// RLS — nunca o superuser), o isolamento por papel. Mesmo padrão de
// subscriptions-rls.e2e-spec.ts: BEGIN + set_config + query, sempre com
// ROLLBACK ao final (nenhum teste altera dados de verdade).
const APP_URL = process.env.DATABASE_URL as string;
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

interface Ctx {
  userId?: string;
  tenantId?: string;
  role?: string;
}

async function asApp<T>(ctx: Ctx, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: APP_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId ?? '']);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId ?? '']);
    await client.query("SELECT set_config('app.role', $1, true)", [ctx.role ?? '']);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

describe('Isolamento multi-tenant via RLS em tenants (e2e)', () => {
  let db: TestDb;
  let superuser: Client;
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let linkedTechnicianUserId: string;
  let unlinkedTechnicianUserId: string;
  let linkedPartnerUserId: string;
  let adminUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    superuser = new Client({ connectionString: SUPERUSER_URL });
    await superuser.connect();

    tenantA = await db.createTenantWithUser('Empresa Tenants RLS A');
    tenantB = await db.createTenantWithUser('Empresa Tenants RLS B');

    linkedTechnicianUserId = (await db.createUserWithRole('tecnico', 'Tecnico Vinculado A')).userId;
    unlinkedTechnicianUserId = (await db.createUserWithRole('tecnico', 'Tecnico Sem Vinculo')).userId;
    linkedPartnerUserId = (await db.createUserWithRole('parceiro', 'Parceiro Vinculado B')).userId;
    adminUserId = (await db.createUserWithRole('admin', 'Admin Tenants RLS')).userId;

    for (const userId of [linkedTechnicianUserId, unlinkedTechnicianUserId]) {
      await superuser.query('INSERT INTO technicians (user_id) VALUES ($1)', [userId]);
    }
    await superuser.query(
      `INSERT INTO tenant_technicians (tenant_id, technician_id)
       SELECT $1, id FROM technicians WHERE user_id = $2`,
      [tenantA.tenantId, linkedTechnicianUserId],
    );
    await superuser.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'SC')`, [linkedPartnerUserId]);
    await superuser.query(
      `INSERT INTO tenant_partners (tenant_id, partner_id)
       SELECT $1, id FROM partners WHERE user_id = $2`,
      [tenantB.tenantId, linkedPartnerUserId],
    );
    await superuser.query(`UPDATE tenants SET logo_file_key = $2 WHERE id = $1`, [
      tenantB.tenantId,
      'tenants/logo-de-teste-b.png',
    ]);
  });

  afterAll(async () => {
    await superuser.end();
    await db.cleanup();
    await db.disconnect();
  });

  const visibleIds = (ctx: Ctx): Promise<string[]> =>
    asApp(ctx, async (client) => {
      const res = await client.query<{ id: string }>('SELECT id FROM tenants WHERE id = ANY($1::uuid[]) ORDER BY id', [
        [tenantA.tenantId, tenantB.tenantId],
      ]);
      return res.rows.map((row) => row.id);
    });

  it('empresa A enxerga só o próprio tenant, nunca o de B', async () => {
    expect(await visibleIds({ userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'empresa' })).toEqual([
      tenantA.tenantId,
    ]);
  });

  it('empresa A vê exatamente 1 linha na tabela inteira (não a lista de todos os clientes)', async () => {
    const count = await asApp({ userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'empresa' }, async (client) =>
      Number((await client.query('SELECT count(*) FROM tenants')).rows[0].count),
    );
    expect(count).toBe(1);
  });

  it('empresa A não consegue alterar o tenant de B (0 linhas afetadas), mas altera o próprio', async () => {
    const ctx = { userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'empresa' };
    const other = await asApp(ctx, async (client) =>
      (await client.query(`UPDATE tenants SET trade_name = 'invasao' WHERE id = $1`, [tenantB.tenantId])).rowCount,
    );
    const own = await asApp(ctx, async (client) =>
      (await client.query(`UPDATE tenants SET trade_name = 'meu-nome' WHERE id = $1`, [tenantA.tenantId])).rowCount,
    );
    expect(other).toBe(0);
    expect(own).toBe(1);
  });

  it('empresa A não consegue criar tenant direto (só a função de registro cria)', async () => {
    await expect(
      asApp({ userId: tenantA.userId, tenantId: tenantA.tenantId, role: 'empresa' }, async (client) =>
        client.query(`INSERT INTO tenants (name, cnpj, status) VALUES ('Clandestina', '12345678000199', 'ativo')`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('admin enxerga todos', async () => {
    const ids = await visibleIds({ userId: adminUserId, role: 'admin' });
    expect(ids.sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());
  });

  it('técnico vinculado a A enxerga A e não B', async () => {
    expect(await visibleIds({ userId: linkedTechnicianUserId, role: 'tecnico' })).toEqual([tenantA.tenantId]);
  });

  it('técnico sem nenhum vínculo não enxerga nenhum dos dois', async () => {
    expect(await visibleIds({ userId: unlinkedTechnicianUserId, role: 'tecnico' })).toEqual([]);
  });

  it('parceiro vinculado a B enxerga B e não A', async () => {
    expect(await visibleIds({ userId: linkedPartnerUserId, role: 'parceiro' })).toEqual([tenantB.tenantId]);
  });

  it('sem contexto nenhum (nenhum set_config), a tabela aparece vazia — falha fechada', async () => {
    expect(await visibleIds({})).toEqual([]);
  });

  it('a rota pública do logo continua funcionando SEM contexto, via tenant_logo_file_key()', async () => {
    const key = await asApp({}, async (client) =>
      (await client.query('SELECT tenant_logo_file_key($1) AS key', [tenantB.tenantId])).rows[0].key,
    );
    expect(key).toBe('tenants/logo-de-teste-b.png');
  });

  it('tenant_logo_file_key() devolve null para id inexistente e não vaza outras colunas', async () => {
    await asApp({}, async (client) => {
      const missing = (await client.query('SELECT tenant_logo_file_key($1) AS key', [randomUUID()])).rows[0].key;
      expect(missing).toBeNull();
      const cols = (await client.query('SELECT * FROM tenant_logo_file_key($1)', [tenantB.tenantId])).fields.map(
        (f) => f.name,
      );
      expect(cols).toEqual(['tenant_logo_file_key']);
    });
  });
});
