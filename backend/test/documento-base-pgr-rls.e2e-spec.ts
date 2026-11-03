import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel E5a, migration 0105: base_draft_id (LTCAT/LIP/laudo -> PGR da mesma empresa).
async function comoSocio<T>(userId: string, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'socio', true)", [userId]);
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
const rejeita = (p: Promise<unknown>, re: RegExp) => p.then(() => false, (e: Error) => re.test(e.message));

describe('document_drafts.base_draft_id — guardas (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let tA: { tenantId: string; userId: string }, tB: { tenantId: string; userId: string };
  let pgrA: string, pgrB: string, ltcatA: string, pcmsoA: string;
  const mk = async (tenantId: string, category: string, extra = '', base: string | null = null) => (await comoSocio(socio.userId, (c) => c.query(
    `INSERT INTO document_drafts (tenant_id, category, title, created_by, base_draft_id${extra ? ', status' : ''}) VALUES ($1,$2,'TESTE base',$3,$4${extra ? `,'${extra}'` : ''}) RETURNING id`,
    [tenantId, category, socio.userId, base]), true)).rows[0].id as string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Base PGR');
    tA = await db.createTenantWithUser('Cliente Montese Base A');
    tB = await db.createTenantWithUser('Cliente Montese Base B');
    pgrA = await mk(tA.tenantId, 'pgr');
    pgrB = await mk(tB.tenantId, 'pgr');
    ltcatA = await mk(tA.tenantId, 'ltcat');
    pcmsoA = await mk(tA.tenantId, 'pcmso');
  });
  afterAll(async () => {
    try { await db.client.query("DELETE FROM document_drafts WHERE title='TESTE base'"); await db.cleanup(); } finally { await db.disconnect(); }
  });

  it('LTCAT/LIP/laudo ligam a um PGR da mesma empresa; é opcional', async () => {
    const l = await mk(tA.tenantId, 'ltcat', '', pgrA);
    expect((await db.client.query('SELECT base_draft_id FROM document_drafts WHERE id=$1', [l])).rows[0].base_draft_id).toBe(pgrA);
    await comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$2 WHERE id=$1', [ltcatA, pgrA]), true);
    await comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=NULL WHERE id=$1', [ltcatA]), true);
  });

  it('recusa PGR de outra empresa, base que não é PGR, categoria sem direito a base e auto-referência', async () => {
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$2 WHERE id=$1', [ltcatA, pgrB])), /outra empresa/)).toBe(true);
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$2 WHERE id=$1', [ltcatA, pcmsoA])), /precisa ser um PGR/)).toBe(true);
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$2 WHERE id=$1', [pcmsoA, pgrA])), /só LTCAT, LIP e laudo/)).toBe(true);
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$1 WHERE id=$1', [ltcatA])), /base de si mesmo|precisa ser um PGR/)).toBe(true);
  });

  it('só muda em elaboração; apagar o PGR-base zera o vínculo sem travar', async () => {
    const l = await mk(tA.tenantId, 'lip', '', pgrA);
    await db.client.query("UPDATE document_drafts SET status='cancelado' WHERE id=$1", [l]);
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=NULL WHERE id=$1', [l]).then((r) => { if (!r.rowCount) throw new Error('sem acesso'); return r; })), /só muda com o documento em elaboração/)).toBe(true);
    const cancelado = await mk(tA.tenantId, 'pgr');
    await db.client.query("UPDATE document_drafts SET status='cancelado' WHERE id=$1", [cancelado]);
    expect(await rejeita(comoSocio(socio.userId, (c) => c.query('UPDATE document_drafts SET base_draft_id=$2 WHERE id=$1', [ltcatA, cancelado])), /cancelado/)).toBe(true);
    const base = await mk(tA.tenantId, 'pgr');
    const filho = await mk(tA.tenantId, 'laudo', '', base);
    await db.client.query('DELETE FROM document_drafts WHERE id=$1', [base]);
    expect((await db.client.query('SELECT base_draft_id FROM document_drafts WHERE id=$1', [filho])).rows[0].base_draft_id).toBeNull();
  });
});
