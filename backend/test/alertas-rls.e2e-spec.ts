import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel E4a, migration 0104: notifications (privacidade por usuário, função de lote), document_change_flags e
// document_validity_rules.notice_days. Conexão na role da aplicação, contexto via set_config local.
type Papel = 'admin' | 'socio' | 'empresa' | 'tecnico' | 'parceiro';
async function comoPapel<T>(role: Papel, userId: string, fn: (c: Client) => Promise<T>, opts: { tenantId?: string; commit?: boolean } = {}): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.role', $3, true)", [userId, opts.tenantId ?? '', role]);
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
const negado = (p: Promise<{ rowCount: number | null }>) =>
  p.then((r) => (r.rowCount ?? 0) === 0, (e: Error) => /permission denied|row-level security/i.test(e.message));
const rejeita = (p: Promise<unknown>, re: RegExp) => p.then(() => false, (e: Error) => re.test(e.message));

describe('alertas — RLS e guardas (e2e)', () => {
  let db: TestDb;
  let admin: TestUserFixture, socio: TestUserFixture, outro: TestUserFixture, tecnico: TestUserFixture;
  let tMontese: { tenantId: string; userId: string };
  let tVinc: { tenantId: string; userId: string };
  let docMontese: string, docVinc: string;
  let regraOriginal: any;
  const comoSocio = <T>(fn: (c: Client) => Promise<T>, commit = false) => comoPapel('socio', socio.userId, fn, { commit });
  const lote = (c: Client, userId: string, key: string) => c.query(
    'SELECT notifications_insert_batch($1::uuid[],$2::text[],$3::text[],$4::text[],$5::uuid[],$6::text[],$7::text[]) AS n',
    [[userId], ['tarefa_atrasada'], ['alta'], ['Tarefa atrasada — TESTE'], [tMontese.tenantId], ['/atuacao/tarefas'], [key]]);

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    admin = await db.createUserWithRole('admin', 'Admin Alertas RLS');
    socio = await db.createUserWithRole('socio', 'Socio Alertas RLS');
    outro = await db.createUserWithRole('socio', 'Outro Socio Alertas RLS');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Alertas RLS');
    tMontese = await db.createTenantWithUser('Cliente Montese Alertas RLS');
    tVinc = await db.createTenantWithUser('Cliente Vinculado Alertas RLS');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tVinc.tenantId, tec.rows[0].id]);
    const mk = async (t: { tenantId: string; userId: string }) => (await db.client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1,'pgr','TESTE doc',$2,'a.pdf','application/pdf',10,$3,'empresa') RETURNING id`, [t.tenantId, `k/${Math.random()}`, t.userId])).rows[0].id as string;
    docMontese = await mk(tMontese);
    docVinc = await mk(tVinc);
    regraOriginal = (await db.client.query("SELECT notice_days, source FROM document_validity_rules WHERE category='pgr'")).rows[0];
  });
  afterAll(async () => {
    try {
      await db.client.query("UPDATE document_validity_rules SET notice_days=$1, source=$2 WHERE category='pgr'", [regraOriginal.notice_days, regraOriginal.source]);
      await db.client.query('DELETE FROM notifications WHERE user_id = ANY($1)', [[socio.userId, outro.userId]]);
      await db.cleanup();
    } finally { await db.disconnect(); }
  });

  it('função de lote: dono com BYPASSRLS, SECURITY DEFINER, sem PUBLIC; só app.role=admin insere; idempotente', async () => {
    const f = (await db.client.query(
      `SELECT r.rolname, r.rolbypassrls, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'execute') AS publico
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'notifications_insert_batch'`)).rows[0];
    expect(f).toMatchObject({ rolname: 'montese_auth_bypass', rolbypassrls: true, prosecdef: true, publico: false });
    expect(f.proconfig).toEqual(['search_path=public, pg_temp']);
    expect((await comoPapel('admin', admin.userId, (c) => lote(c, socio.userId, 'k-1'), { commit: true })).rows[0].n).toBe(1);
    expect((await comoPapel('admin', admin.userId, (c) => lote(c, socio.userId, 'k-1'), { commit: true })).rows[0].n).toBe(0);
    for (const papel of ['socio', 'empresa', 'tecnico', 'parceiro'] as const) {
      const r = await comoPapel(papel, socio.userId, (c) => lote(c, socio.userId, `k-${papel}`), { tenantId: tMontese.tenantId, commit: true });
      expect([papel, r.rows[0].n]).toEqual([papel, 0]);
    }
    expect((await db.client.query("SELECT 1 FROM notifications WHERE dedupe_key LIKE 'k-%' AND dedupe_key <> 'k-1'")).rowCount).toBe(0);
  });

  it('notificações: sócio lê só as próprias; admin, empresa, técnico e parceiro não leem; ninguém insere direto', async () => {
    await comoPapel('admin', admin.userId, (c) => lote(c, outro.userId, 'k-outro'), { commit: true });
    const minhas = await comoSocio((c) => c.query('SELECT dedupe_key FROM notifications ORDER BY dedupe_key'));
    expect(minhas.rows.map((r) => r.dedupe_key)).toEqual(['k-1']);
    for (const papel of ['admin', 'empresa', 'tecnico', 'parceiro'] as const) {
      expect([papel, (await comoPapel(papel, tecnico.userId, (c) => c.query('SELECT 1 FROM notifications'), { tenantId: tMontese.tenantId })).rowCount]).toEqual([papel, 0]);
    }
    expect(await negado(comoSocio((c) => c.query("INSERT INTO notifications (user_id,type,priority,title,dedupe_key) VALUES ($1,'tarefa_atrasada','alta','x','direto')", [socio.userId])))).toBe(true);
    expect(await negado(comoPapel('admin', admin.userId, (c) => c.query("INSERT INTO notifications (user_id,type,priority,title,dedupe_key) VALUES ($1,'tarefa_atrasada','alta','x','direto')", [socio.userId])))).toBe(true);
    expect(await negado(comoSocio((c) => c.query('DELETE FROM notifications')))).toBe(true);
  });

  it('notificações: só read_at muda, uma vez; não mexe nas de outro usuário', async () => {
    expect(await rejeita(comoSocio((c) => c.query("UPDATE notifications SET title='outro' WHERE dedupe_key='k-1'")), /só read_at/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE notifications SET priority='baixa' WHERE dedupe_key='k-1'")), /só read_at/)).toBe(true);
    expect((await comoSocio((c) => c.query("UPDATE notifications SET read_at = now() WHERE dedupe_key IN ('k-1','k-outro')"), true)).rowCount).toBe(1);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE notifications SET read_at = NULL WHERE dedupe_key='k-1'")), /não volta/)).toBe(true);
    expect((await db.client.query("SELECT read_at FROM notifications WHERE dedupe_key='k-outro'")).rows[0].read_at).toBeNull();
  });

  it('notificações: href só aceita caminho interno /atuacao; título não vazio', async () => {
    const ins = (href: string | null, title = 'ok') => comoPapel('admin', admin.userId, (c) => c.query(
      'SELECT notifications_insert_batch($1::uuid[],$2::text[],$3::text[],$4::text[],$5::uuid[],$6::text[],$7::text[])',
      [[socio.userId], ['tarefa_atrasada'], ['alta'], [title], [null], [href], [`h-${Math.random()}`]]), { commit: true });
    expect(await rejeita(ins('https://evil.example/x'), /check|notifications_href/i)).toBe(true);
    expect(await rejeita(ins('/atuacao/../admin'), /check|notifications_href/i)).toBe(true);
    expect(await rejeita(ins('/atuacao/ok', '   '), /check|notifications_title/i)).toBe(true);
    await ins('/atuacao/empresas/abc');
    await ins(null);
  });

  it('revisão por mudança: carteira Montese; empresa/técnico/parceiro fora; documento do mesmo tenant; resolução única e do próprio usuário', async () => {
    const ins = (over: Record<string, unknown> = {}) => comoSocio((c) => c.query(
      "INSERT INTO document_change_flags (tenant_id, document_id, category, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [over.tenant ?? tMontese.tenantId, over.doc ?? null, over.cat ?? 'pgr', over.reason ?? 'risco', over.by ?? socio.userId]), true);
    const id = (await ins()).rows[0].id as string;
    expect(await negado(ins({ by: outro.userId }) as any)).toBe(true);
    expect(await negado(ins({ tenant: tVinc.tenantId }) as any)).toBe(true);
    expect(await rejeita(ins({ doc: docVinc }), /outro tenant/)).toBe(true);
    expect(await rejeita(ins({ reason: 'qualquer' }), /check/i)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("INSERT INTO document_change_flags (tenant_id, reason, created_by) VALUES ($1,'risco',$2)", [tMontese.tenantId, socio.userId])), /target_chk|check/i)).toBe(true);
    expect((await ins({ doc: docMontese, cat: null })).rows[0].id).toBeTruthy();
    for (const papel of ['empresa', 'tecnico', 'parceiro'] as const) {
      expect((await comoPapel(papel, tecnico.userId, (c) => c.query('SELECT 1 FROM document_change_flags'), { tenantId: tMontese.tenantId })).rowCount).toBe(0);
    }
    expect((await comoPapel('admin', admin.userId, (c) => c.query('SELECT 1 FROM document_change_flags WHERE id=$1', [id]))).rowCount).toBe(1);
    expect(await negado(comoPapel('admin', admin.userId, (c) => c.query("UPDATE document_change_flags SET resolved_by=$2, resolved_at=now() WHERE id=$1", [id, admin.userId])))).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_change_flags SET note='x' WHERE id=$1", [id])), /origem/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_change_flags SET resolved_by=$2, resolved_at=now() WHERE id=$1", [id, outro.userId])), /quem a faz/)).toBe(true);
    await comoSocio((c) => c.query("UPDATE document_change_flags SET resolved_by=$2, resolved_at=now() WHERE id=$1", [id, socio.userId]), true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_change_flags SET resolution_note='x' WHERE id=$1", [id])), /já resolvido|origem/)).toBe(true);
    expect(await negado(comoSocio((c) => c.query('DELETE FROM document_change_flags WHERE id=$1', [id])))).toBe(true);
  });

  it('antecedências da regra existente: valores 0..365, 1..8 itens; nulo = padrão; meses intactos', async () => {
    const upd = (v: number[] | null) => comoSocio((c) => c.query("UPDATE document_validity_rules SET notice_days=$1 WHERE category='pgr'", [v]), true);
    await upd([30, 7, 0]);
    await upd(null);
    for (const ruim of [[], [-1], [366], [1, 2, 3, 4, 5, 6, 7, 8, 9], [null as unknown as number]]) {
      expect([JSON.stringify(ruim), await rejeita(upd(ruim), /check|notice_days/i)]).toEqual([JSON.stringify(ruim), true]);
    }
    expect((await db.client.query("SELECT validity_months FROM document_validity_rules WHERE category='pgr'")).rows[0].validity_months).toBe(24);
  });

  it('regras de validade: RLS ligada; sócio altera só antecedências/fonte; admin altera meses; técnico/empresa não escrevem', async () => {
    const rls = (await db.client.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='document_validity_rules'")).rows[0];
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const lerComo = (role: Papel, uid: string) => comoPapel(role, uid, (c) => c.query("SELECT 1 FROM document_validity_rules WHERE category='pgr'"));
    for (const [role, uid] of [['socio', socio.userId], ['tecnico', tecnico.userId], ['empresa', tMontese.userId], ['admin', admin.userId]] as const) {
      expect([role, (await lerComo(role, uid)).rowCount]).toEqual([role, 1]);
    }
    for (const col of ['validity_months=12', 'alert_days=5', "category='ltcat'"]) {
      expect([col, await rejeita(comoSocio((c) => c.query(`UPDATE document_validity_rules SET ${col} WHERE category='pgr'`)), /só altera antecedências/)]).toEqual([col, true]);
    }
    for (const [role, uid] of [['tecnico', tecnico.userId], ['empresa', tMontese.userId], ['parceiro', tMontese.userId]] as const) {
      expect([role, await negado(comoPapel(role, uid, (c) => c.query("UPDATE document_validity_rules SET notice_days='{7}' WHERE category='pgr'")))]).toEqual([role, true]);
    }
    const antes = (await db.client.query("SELECT validity_months FROM document_validity_rules WHERE category='pgr'")).rows[0].validity_months;
    await comoPapel('admin', admin.userId, (c) => c.query("UPDATE document_validity_rules SET validity_months=$1 WHERE category='pgr'", [antes]), { commit: true });
    expect(await rejeita(comoSocio((c) => c.query("INSERT INTO document_validity_rules (category, validity_months) VALUES ('pgr', 1)")), /row-level security|duplicate/i)).toBe(true);
  });
});
