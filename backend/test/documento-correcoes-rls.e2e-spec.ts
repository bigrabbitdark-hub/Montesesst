import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel E2, migration 0102: document_corrections (RLS por papel, guardas de transição/origem/responsável).
// Conexão na role da aplicação (sujeita a RLS), contexto via set_config local. Nenhum dado profissional real.
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

describe('document_corrections — RLS e guardas (e2e)', () => {
  let db: TestDb;
  let admin: TestUserFixture, socio: TestUserFixture, outroSocio: TestUserFixture, tecnico: TestUserFixture;
  let tMontese: { tenantId: string; userId: string };
  let tVinculado: { tenantId: string; userId: string };
  let draft: string, draftVinc: string, version: string;

  const comoSocio = <T>(fn: (c: Client) => Promise<T>, commit = false) => comoPapel('socio', socio.userId, fn, { commit });
  const inserir = (c: Client, over: Record<string, unknown> = {}) => {
    const v = { draft_id: draft, tenant_id: tMontese.tenantId, version_id: version, description: 'Corrigir item 3', origin: 'revisao', requester_label: null, requested_by: socio.userId, responsible_user_id: socio.userId, due_date: '2026-12-01', ...over };
    return c.query(
      `INSERT INTO document_corrections (draft_id, tenant_id, version_id, description, origin, requester_label, requested_by, responsible_user_id, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [v.draft_id, v.tenant_id, v.version_id, v.description, v.origin, v.requester_label, v.requested_by, v.responsible_user_id, v.due_date],
    );
  };
  const criar = async (over: Record<string, unknown> = {}) => (await comoSocio((c) => inserir(c, over), true)).rows[0].id as string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    admin = await db.createUserWithRole('admin', 'Admin Correcoes');
    socio = await db.createUserWithRole('socio', 'Socio Correcoes');
    outroSocio = await db.createUserWithRole('socio', 'Outro Socio Correcoes');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Correcoes');
    tMontese = await db.createTenantWithUser('Cliente Montese Correcoes');
    tVinculado = await db.createTenantWithUser('Cliente Vinculado Correcoes');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tVinculado.tenantId, tec.rows[0].id]);
    const mk = async (tenantId: string) => (await db.client.query(
      "INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', 'TESTE Rascunho correcoes', $2) RETURNING id", [tenantId, socio.userId])).rows[0].id as string;
    draft = await mk(tMontese.tenantId);
    draftVinc = await mk(tVinculado.tenantId);
    version = (await db.client.query(
      "INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by) VALUES ($1,$2,1,'documents-fluxo/teste/1','a.pdf','application/pdf',10,$3,$4) RETURNING id",
      [draft, tMontese.tenantId, 'a'.repeat(64), socio.userId])).rows[0].id;
  });

  afterAll(async () => {
    try { await db.cleanup(); } finally { await db.disconnect(); }
  });

  it('sócio insere e lê correção da carteira Montese; fica aberta', async () => {
    const id = await criar();
    const r = await comoSocio((c) => c.query('SELECT status, origin FROM document_corrections WHERE id = $1', [id]));
    expect(r.rows[0]).toEqual({ status: 'aberta', origin: 'revisao' });
  });

  it('sócio não registra em nome de outro, nem em empresa fora da carteira, nem já nascida encerrada', async () => {
    expect(await negado(comoSocio((c) => inserir(c, { requested_by: outroSocio.userId })))).toBe(true);
    // A guarda BEFORE INSERT enxerga o rascunho pela RLS do sócio: fora da carteira ele não existe para ele.
    expect(await rejeita(comoSocio((c) => inserir(c, { draft_id: draftVinc, tenant_id: tVinculado.tenantId, version_id: null })), /rascunho inexistente|row-level security/i)).toBe(true);
    expect(await negado(comoSocio((c) => c.query(
      `INSERT INTO document_corrections (draft_id, tenant_id, description, origin, requested_by, responsible_user_id, status)
       VALUES ($1,$2,'x','interna',$3,$3,'cancelada')`, [draft, tMontese.tenantId, socio.userId])))).toBe(true);
  });

  it('guardas do INSERT: tenant divergente do rascunho, versão de outro rascunho, responsável que não é sócio ativo, cliente sem solicitante', async () => {
    expect(await rejeita(comoSocio((c) => inserir(c, { tenant_id: tVinculado.tenantId })), /row-level security|rascunho inexistente/i)).toBe(true);
    expect(await rejeita(comoSocio((c) => inserir(c, { version_id: '00000000-0000-4000-8000-000000000000' })), /foreign key|version_id|violates/i)).toBe(true);
    expect(await rejeita(comoSocio((c) => inserir(c, { responsible_user_id: tecnico.userId })), /sócio ativo/)).toBe(true);
    expect(await rejeita(comoSocio((c) => inserir(c, { origin: 'cliente' })), /solicitou/)).toBe(true);
    expect(await comoSocio((c) => inserir(c, { origin: 'cliente', requester_label: 'RH do cliente' }))).toBeTruthy();
  });

  it('empresa, técnico e parceiro não leem nem escrevem; admin só lê', async () => {
    const id = await criar();
    for (const papel of ['empresa', 'tecnico', 'parceiro'] as const) {
      const lido = await comoPapel(papel, tecnico.userId, (c) => c.query('SELECT 1 FROM document_corrections WHERE id = $1', [id]), { tenantId: tMontese.tenantId });
      expect(lido.rowCount).toBe(0);
      expect(await negado(comoPapel(papel, tecnico.userId, (c) => c.query("UPDATE document_corrections SET status='cancelada' WHERE id=$1", [id]), { tenantId: tMontese.tenantId }))).toBe(true);
    }
    expect((await comoPapel('admin', admin.userId, (c) => c.query('SELECT 1 FROM document_corrections WHERE id = $1', [id]))).rowCount).toBe(1);
    expect(await negado(comoPapel('admin', admin.userId, (c) => c.query("UPDATE document_corrections SET status='cancelada' WHERE id=$1", [id])))).toBe(true);
  });

  it('transições: aberta -> corrigida -> verificada; não pula, não reabre encerrada, carimbos só do próprio usuário', async () => {
    const id = await criar();
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_corrections SET status='verificada', verified_by=$2, verified_at=now() WHERE id=$1", [id, socio.userId])), /transição inválida/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_corrections SET status='corrigida', corrected_by=$2, corrected_at=now() WHERE id=$1", [id, outroSocio.userId])), /autoria/)).toBe(true);
    await comoSocio((c) => c.query("UPDATE document_corrections SET status='corrigida', corrected_by=$2, corrected_at=now() WHERE id=$1", [id, socio.userId]), true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_corrections SET status='verificada', verified_by=$2, verified_at=now() WHERE id=$1", [id, outroSocio.userId])), /autoria/)).toBe(true);
    await comoSocio((c) => c.query("UPDATE document_corrections SET status='verificada', verified_by=$2, verified_at=now() WHERE id=$1", [id, socio.userId]), true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_corrections SET status='aberta' WHERE id=$1", [id])), /encerrada/)).toBe(true);
  });

  it('reabrir limpa os carimbos de correção; ajustar responsável/prazo funciona; responsável inválido é recusado', async () => {
    const id = await criar();
    await comoSocio((c) => c.query("UPDATE document_corrections SET status='corrigida', corrected_by=$2, corrected_at=now() WHERE id=$1", [id, socio.userId]), true);
    await comoSocio((c) => c.query("UPDATE document_corrections SET status='aberta', resolution_note='faltou o anexo' WHERE id=$1", [id]), true);
    const r = await comoSocio((c) => c.query('SELECT status, corrected_by, corrected_at FROM document_corrections WHERE id=$1', [id]));
    expect(r.rows[0]).toEqual({ status: 'aberta', corrected_by: null, corrected_at: null });
    await comoSocio((c) => c.query("UPDATE document_corrections SET responsible_user_id=$2, due_date='2027-01-15' WHERE id=$1", [id, outroSocio.userId]), true);
    expect(await rejeita(comoSocio((c) => c.query('UPDATE document_corrections SET responsible_user_id=$2 WHERE id=$1', [id, tecnico.userId])), /sócio ativo/)).toBe(true);
  });

  it('campos de origem são imutáveis; não há DELETE; documento publicado/cancelado não aceita correção nova', async () => {
    const id = await criar();
    for (const set of ["description='outra'", "origin='interna'", `requested_by='${outroSocio.userId}'`, `tenant_id='${tVinculado.tenantId}'`]) {
      expect(await rejeita(comoSocio((c) => c.query(`UPDATE document_corrections SET ${set} WHERE id=$1`, [id])), /imutáveis|row-level security/i)).toBe(true);
    }
    expect(await negado(comoSocio((c) => c.query('DELETE FROM document_corrections WHERE id=$1', [id])))).toBe(true);
    await db.client.query("ALTER TABLE document_drafts DISABLE TRIGGER USER");
    try {
      await db.client.query("UPDATE document_drafts SET status='cancelado' WHERE id=$1", [draft]);
    } finally {
      await db.client.query("ALTER TABLE document_drafts ENABLE TRIGGER USER");
    }
    expect(await rejeita(comoSocio((c) => inserir(c)), /publicado ou cancelado/)).toBe(true);
    await db.client.query("ALTER TABLE document_drafts DISABLE TRIGGER USER");
    try { await db.client.query("UPDATE document_drafts SET status='em_elaboracao' WHERE id=$1", [draft]); } finally { await db.client.query("ALTER TABLE document_drafts ENABLE TRIGGER USER"); }
  });

  it('trava no banco: rascunho com correção pendente não vai a aprovado; cancelamento registra quem cancelou', async () => {
    const d = (await db.client.query(
      "INSERT INTO document_drafts (tenant_id, category, title, created_by, status) VALUES ($1,'pgr','TESTE trava',$2,'em_revisao') RETURNING id", [tMontese.tenantId, socio.userId])).rows[0].id as string;
    const id = (await comoSocio((c) => inserir(c, { draft_id: d, version_id: null }), true)).rows[0].id as string;
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_drafts SET status='aprovado' WHERE id=$1", [d])), /correções pendentes/)).toBe(true);
    await comoSocio((c) => c.query("UPDATE document_corrections SET status='cancelada' WHERE id=$1", [id]), true);
    const r = await comoSocio((c) => c.query('SELECT cancelled_by, cancelled_at FROM document_corrections WHERE id=$1', [id]));
    expect(r.rows[0].cancelled_by).toBe(socio.userId);
    expect(r.rows[0].cancelled_at).not.toBeNull();
    // sem correção pendente, quem barra é o guard existente (falta o evento approved), não a trava de correções
    expect(await rejeita(comoSocio((c) => c.query("UPDATE document_drafts SET status='aprovado' WHERE id=$1", [d])), /evento approved/)).toBe(true);
  });
});
