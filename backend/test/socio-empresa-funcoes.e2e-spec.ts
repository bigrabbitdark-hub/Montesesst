import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb, TestUserFixture } from './db-test-helper';

// 0108: funções SQL do cadastro por sócio e do modo "atuar como empresa".
// Conexão na role da aplicação (sujeita a RLS). commit=true só onde o resultado precisa ser lido depois.
async function como<T>(
  ctx: { userId: string; role: string },
  fn: (c: Client) => Promise<T>,
  commit = false,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', $2, true)",
      [ctx.userId, ctx.role],
    );
    const out = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0');
const email = () => `socio-${randomUUID().slice(0, 8)}@teste.montese.local`;

describe('0108 — funções SQL do sócio (e2e DB)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let semPermissao: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let comTecnico: { tenantId: string; userId: string };
  const criados: string[] = [];

  const conceder = (userId: string, ...perms: string[]) =>
    Promise.all(perms.map((p) => db.client.query('INSERT INTO socio_permissions (user_id, permission) VALUES ($1,$2)', [userId, p])));

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio 0108');
    semPermissao = await db.createUserWithRole('socio', 'Socio sem permissao 0108');
    await conceder(socio.userId, 'empresas.criar', 'empresas.atuar');
    montese = await db.createTenantWithUser('Montese 0108');
    comTecnico = await db.createTenantWithUser('Com Tecnico 0108');
    const tecnico = await db.createUserWithRole('tecnico', 'Tec 0108');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [comTecnico.tenantId, tec.rows[0].id]);
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id = ANY($1)", [[montese.tenantId, comTecnico.tenantId]]);
  }, 60000);

  afterAll(async () => {
    if (criados.length) await db.client.query('DELETE FROM tenants WHERE id = ANY($1)', [criados]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1)', [[socio.userId, semPermissao.userId]]);
    await db.cleanup();
  });

  it('socio_create_company cria tenant ativo, usuário ativo com troca obrigatória e carteira', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Empresa Nova 0108', cnpj(), em, 'hash-fake', 'RH Teste'])).rows[0],
      true);
    criados.push(r.tenant_id);
    const t = (await db.client.query('SELECT status, plan FROM tenants WHERE id=$1', [r.tenant_id])).rows[0];
    const u = (await db.client.query('SELECT role, status, must_change_password, tenant_id FROM users WHERE id=$1', [r.user_id])).rows[0];
    const o = (await db.client.query('SELECT 1 FROM tenant_owners WHERE tenant_id=$1 AND user_id=$2', [r.tenant_id, socio.userId])).rowCount;
    expect(t).toEqual({ status: 'ativo', plan: 'trial' });
    expect(u).toEqual({ role: 'empresa', status: 'ativo', must_change_password: true, tenant_id: r.tenant_id });
    expect(o).toBe(1);
    const montese2 = (await db.client.query('SELECT is_montese_tenant($1) AS ok', [r.tenant_id])).rows[0].ok;
    expect(montese2).toBe(true);
  });

  it('socio_create_company recusa sócio sem empresas.criar', async () => {
    await expect(
      como({ userId: semPermissao.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [semPermissao.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('socio_create_company recusa papel diferente de socio e p_socio_id diferente do app.user_id', async () => {
    await expect(
      como({ userId: montese.userId, role: 'empresa' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [montese.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      como({ userId: semPermissao.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('socio_create_company propaga e-mail duplicado (23505)', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Dup A 0108', cnpj(), em, 'h', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    await expect(
      como({ userId: socio.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Dup B 0108', cnpj(), em, 'h', 'RH'])),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('socio_can_act_on_tenant: true só para empresa da Montese, com permissão, ativa', async () => {
    const pode = (uid: string, tid: string, role = 'socio', asUid = uid) =>
      como({ userId: asUid, role }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [uid, tid])).rows[0].ok);
    expect(await pode(socio.userId, montese.tenantId)).toBe(true);
    expect(await pode(socio.userId, comTecnico.tenantId)).toBe(false);       // vínculo com técnico
    expect(await pode(semPermissao.userId, montese.tenantId)).toBe(false);   // sem empresas.atuar
    expect(await pode(socio.userId, randomUUID())).toBe(false);              // tenant inexistente
    expect(await pode(socio.userId, montese.tenantId, 'empresa')).toBe(false); // papel errado
    expect(await pode(socio.userId, montese.tenantId, 'socio', semPermissao.userId)).toBe(false); // id ≠ app.user_id
    try {
      await db.client.query("UPDATE tenants SET status='inativo' WHERE id=$1", [montese.tenantId]);
      expect(await pode(socio.userId, montese.tenantId)).toBe(false);        // tenant inativo
    } finally {
      await db.client.query("UPDATE tenants SET status='ativo' WHERE id=$1", [montese.tenantId]);
    }
  });

  it('socio_can_act_on_tenant: empresa com técnico marcada no portfólio NÃO pode (não usa is_montese_tenant)', async () => {
    const pode = (tid: string) =>
      como({ userId: socio.userId, role: 'socio' }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [socio.userId, tid])).rows[0].ok);
    await db.client.query('INSERT INTO socio_portfolio (tenant_id) VALUES ($1)', [comTecnico.tenantId]);
    try {
      const visivel = (await db.client.query('SELECT is_montese_tenant($1) AS ok', [comTecnico.tenantId])).rows[0].ok;
      expect(visivel).toBe(true); // o portfólio a torna visível ao painel...
      expect(await pode(comTecnico.tenantId)).toBe(false); // ...mas não permite atuar
    } finally {
      await db.client.query('DELETE FROM socio_portfolio WHERE tenant_id=$1', [comTecnico.tenantId]);
    }
  });

  it('funções socio_*: contexto ausente, papel/usuário/status inconsistentes', async () => {
    const semCtx = async <T>(fn: (c: Client) => Promise<T>) => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      try { await c.query('BEGIN'); const o = await fn(c); await c.query('ROLLBACK'); return o; }
      catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
      finally { await c.end(); }
    };
    // (e) sem set_config algum
    const r = await semCtx((c) => c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [socio.userId, montese.tenantId]));
    expect(r.rows[0].ok).toBe(false); // false, nunca NULL
    await expect(semCtx((c) => c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])))
      .rejects.toMatchObject({ code: '42501' });
    // (c) tem empresas.criar, mas app.role='empresa'
    await expect(como({ userId: socio.userId, role: 'empresa' }, (c) =>
      c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])))
      .rejects.toMatchObject({ code: '42501' });
    // (d) app.role='socio' mas o usuário no banco não é socio (com as permissões concedidas)
    const falso = await db.createUserWithRole('tecnico', 'Falso Socio 0108');
    await conceder(falso.userId, 'empresas.criar', 'empresas.atuar');
    // (d) sócio inativo
    const inativo = await db.createUserWithRole('socio', 'Socio inativo 0108');
    await conceder(inativo.userId, 'empresas.criar', 'empresas.atuar');
    await db.client.query("UPDATE users SET status='inativo' WHERE id=$1", [inativo.userId]);
    for (const u of [falso, inativo]) {
      await expect(como({ userId: u.userId, role: 'socio' }, (c) =>
        c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [u.userId, 'X Empresa', cnpj(), email(), 'h', 'RH'])))
        .rejects.toMatchObject({ code: '42501' });
      const ok = await como({ userId: u.userId, role: 'socio' }, async (c) =>
        (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [u.userId, montese.tenantId])).rows[0].ok);
      expect(ok).toBe(false);
    }
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1)', [[falso.userId, inativo.userId]]);
  });

  it('vínculo criado depois derruba a permissão de atuar', async () => {
    const outro = await db.createTenantWithUser('Vira Tecnico 0108');
    await db.client.query("UPDATE tenants SET status='ativo' WHERE id=$1", [outro.tenantId]);
    const pode = () => como({ userId: socio.userId, role: 'socio' }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [socio.userId, outro.tenantId])).rows[0].ok);
    expect(await pode()).toBe(true);
    const tec = await db.createUserWithRole('tecnico', 'Tec Vinculo 0108');
    const t = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1,$2)', [outro.tenantId, t.rows[0].id]);
    expect(await pode()).toBe(false);
  });

  it('socio_can_act_on_tenant: empresa com PARCEIRO vinculado => false (antes do vínculo: true)', async () => {
    const comParceiro = await db.createTenantWithUser('Com Parceiro 0108');
    const pode = () => como({ userId: socio.userId, role: 'socio' }, async (c) => (await c.query('SELECT socio_can_act_on_tenant($1,$2) AS ok', [socio.userId, comParceiro.tenantId])).rows[0].ok);
    expect(await pode()).toBe(true);
    const parUser = await db.createUserWithRole('parceiro', 'Parc Vinculo 0108');
    const p = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul') RETURNING id", [parUser.userId]);
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1,$2)', [comParceiro.tenantId, p.rows[0].id]);
    expect(await pode()).toBe(false);
  });

  it('auth_user_must_change_password, auth_own_password_hash e auth_change_password', async () => {
    const em = email();
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Troca Senha 0108', cnpj(), em, 'hash-velho', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    const ctx = { userId: r.user_id, role: 'empresa' };
    const flag = () => como(ctx, async (c) => (await c.query('SELECT auth_user_must_change_password($1) AS v', [r.user_id])).rows[0].v);
    expect(await flag()).toBe(true);
    expect(await como(ctx, async (c) => (await c.query('SELECT auth_own_password_hash($1) AS h', [r.user_id])).rows[0].h)).toBe('hash-velho');
    // outro usuário não lê o hash alheio
    await expect(como({ userId: socio.userId, role: 'socio' }, (c) => c.query('SELECT auth_own_password_hash($1)', [r.user_id]))).resolves.toMatchObject({ rows: [{ auth_own_password_hash: null }] });
    // hash antigo errado: nenhuma linha
    expect((await como(ctx, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'errado', 'hash-novo'], ))).rowCount).toBe(0);
    expect((await como(ctx, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'hash-velho', 'hash-novo']), true)).rowCount).toBe(1);
    expect(await flag()).toBe(false);
  });

  it('auth_change_password: app.user_id diferente de p_user_id e usuário inativo => 0 linhas, hash intacto', async () => {
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Troca Alheia 0108', cnpj(), email(), 'hash-alvo', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    const hash = async () => (await db.client.query('SELECT password_hash FROM users WHERE id=$1', [r.user_id])).rows[0].password_hash;
    // (a) outro usuário autenticado tenta trocar a senha alheia, mesmo sabendo o hash antigo
    const a = await como({ userId: socio.userId, role: 'socio' }, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'hash-alvo', 'hash-invasor'], ), true);
    expect(a.rowCount).toBe(0);
    expect(await hash()).toBe('hash-alvo');
    // (b) usuário inativo
    await db.client.query("UPDATE users SET status='inativo' WHERE id=$1", [r.user_id]);
    const b = await como({ userId: r.user_id, role: 'empresa' }, (c) => c.query('SELECT * FROM auth_change_password($1,$2,$3)', [r.user_id, 'hash-alvo', 'hash-novo']), true);
    expect(b.rowCount).toBe(0);
    expect(await hash()).toBe('hash-alvo');
  });

  // Ruling 21: o reset por e-mail (0058, redefinida na 0108) prova posse do endereço => limpa a troca obrigatória.
  // Chamada SEM contexto de tenant, como o PasswordResetService (withoutTenantContext).
  it('auth_reset_password limpa must_change_password com o hash correto; hash errado => 0 linhas e flag intacta', async () => {
    const r = await como({ userId: socio.userId, role: 'socio' }, async (c) =>
      (await c.query('SELECT * FROM socio_create_company($1,$2,$3,$4,$5,$6)', [socio.userId, 'Reset Senha 0108', cnpj(), email(), 'hash-reset-velho', 'RH'])).rows[0], true);
    criados.push(r.tenant_id);
    const linha = async () => (await db.client.query('SELECT password_hash, must_change_password FROM users WHERE id=$1', [r.user_id])).rows[0];
    const reset = async (velho: string, novo: string) => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      try {
        return await c.query('SELECT * FROM auth_reset_password($1,$2,$3)', [r.user_id, velho, novo]);
      } finally {
        await c.end();
      }
    };
    expect(await linha()).toEqual({ password_hash: 'hash-reset-velho', must_change_password: true });
    const errado = await reset('hash-errado', 'hash-reset-novo');
    expect(errado.rowCount).toBe(0);
    expect(await linha()).toEqual({ password_hash: 'hash-reset-velho', must_change_password: true });
    const certo = await reset('hash-reset-velho', 'hash-reset-novo');
    expect(certo.rows).toEqual([{ user_id: r.user_id, tenant_id: r.tenant_id, role: 'empresa' }]);
    expect(await linha()).toEqual({ password_hash: 'hash-reset-novo', must_change_password: false });
  });
});
