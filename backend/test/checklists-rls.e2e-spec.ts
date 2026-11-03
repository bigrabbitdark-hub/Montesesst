import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel E3a, migration 0103: modelos de checklist (globais, versionados) e instâncias por documento (RLS + guardas).
// Nenhum conteúdo técnico real: rótulos de teste.
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

describe('checklists — RLS e guardas (e2e)', () => {
  let db: TestDb;
  let admin: TestUserFixture, socio: TestUserFixture, outroSocio: TestUserFixture, tecnico: TestUserFixture;
  let tMontese: { tenantId: string; userId: string };
  let tVinculado: { tenantId: string; userId: string };
  let draft: string, draftVinc: string;
  let nome = 0;

  const comoSocio = <T>(fn: (c: Client) => Promise<T>, commit = false) => comoPapel('socio', socio.userId, fn, { commit });

  async function novoModelo(itens: Array<{ kind: string; required?: boolean; blocks?: boolean }> = [{ kind: 'sim_nao_na' }], aprovar = false) {
    const t = (await comoSocio((c) => c.query(
      "INSERT INTO checklist_templates (service, name, created_by) VALUES ('pgr', $1, $2) RETURNING id", [`TESTE modelo ${++nome} ${Math.random()}`, socio.userId]), true)).rows[0].id as string;
    const v = (await comoSocio((c) => c.query(
      "INSERT INTO checklist_template_versions (template_id, version_number, created_by) VALUES ($1, 1, $2) RETURNING id", [t, socio.userId]), true)).rows[0].id as string;
    const ids: string[] = [];
    let pos = 1;
    for (const i of itens) {
      ids.push((await comoSocio((c) => c.query(
        'INSERT INTO checklist_template_items (version_id, position, label, kind, required, blocks_review) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [v, pos++, `TESTE item ${pos}`, i.kind, i.required ?? true, i.blocks ?? false]), true)).rows[0].id);
    }
    if (aprovar) await aprovarVersao(v);
    return { t, v, ids };
  }
  const aprovarVersao = (v: string) => comoSocio((c) => c.query(
    "UPDATE checklist_template_versions SET status='aprovado', approved_by=$2, approved_at=now() WHERE id=$1", [v, socio.userId]), true);
  const instancia = (v: string, over: Record<string, unknown> = {}) => comoSocio((c) => c.query(
    'INSERT INTO document_checklists (draft_id, tenant_id, template_version_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [over.draft ?? draft, over.tenant ?? tMontese.tenantId, v, over.by ?? socio.userId]), true);
  const responder = (cl: string, item: string, value: string, over: Record<string, unknown> = {}) => comoSocio((c) => c.query(
    'INSERT INTO document_checklist_answers (checklist_id, tenant_id, item_id, value, answered_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [cl, over.tenant ?? tMontese.tenantId, item, value, over.by ?? socio.userId]), true);

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    admin = await db.createUserWithRole('admin', 'Admin Checklists');
    socio = await db.createUserWithRole('socio', 'Socio Checklists');
    outroSocio = await db.createUserWithRole('socio', 'Outro Socio Checklists');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Checklists');
    tMontese = await db.createTenantWithUser('Cliente Montese Checklists');
    tVinculado = await db.createTenantWithUser('Cliente Vinculado Checklists');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tVinculado.tenantId, tec.rows[0].id]);
    const mk = async (tenantId: string) => (await db.client.query(
      "INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', 'TESTE Rascunho checklist', $2) RETURNING id", [tenantId, socio.userId])).rows[0].id as string;
    draft = await mk(tMontese.tenantId);
    draftVinc = await mk(tVinculado.tenantId);
  });
  afterAll(async () => {
    try {
      await db.client.query('DELETE FROM document_checklists WHERE tenant_id = ANY($1)', [[tMontese.tenantId, tVinculado.tenantId]]);
      await db.client.query("DELETE FROM checklist_templates WHERE name LIKE 'TESTE modelo%'");
      await db.cleanup();
    } finally { await db.disconnect(); }
  });

  it('empresa, técnico e parceiro não leem nem escrevem modelos; admin lê e não escreve', async () => {
    const { t, v } = await novoModelo();
    for (const papel of ['empresa', 'tecnico', 'parceiro'] as const) {
      for (const tab of ['checklist_templates', 'checklist_template_versions', 'checklist_template_items']) {
        const r = await comoPapel(papel, tecnico.userId, (c) => c.query(`SELECT 1 FROM ${tab}`), { tenantId: tMontese.tenantId });
        expect([papel, tab, r.rowCount]).toEqual([papel, tab, 0]);
      }
      expect(await negado(comoPapel(papel, tecnico.userId, (c) => c.query("INSERT INTO checklist_templates (service,name,created_by) VALUES ('pgr','x',$1)", [tecnico.userId]), { tenantId: tMontese.tenantId }))).toBe(true);
    }
    expect((await comoPapel('admin', admin.userId, (c) => c.query('SELECT 1 FROM checklist_templates WHERE id=$1', [t]))).rowCount).toBe(1);
    expect(await negado(comoPapel('admin', admin.userId, (c) => c.query("UPDATE checklist_template_versions SET change_note='x' WHERE id=$1", [v])))).toBe(true);
  });

  it('autoria e estado inicial: sócio não cria modelo/versão em nome de outro nem versão já aprovada', async () => {
    expect(await negado(comoSocio((c) => c.query("INSERT INTO checklist_templates (service,name,created_by) VALUES ('pgr','TESTE modelo x',$1)", [outroSocio.userId])))).toBe(true);
    const { t } = await novoModelo();
    expect(await negado(comoSocio((c) => c.query("INSERT INTO checklist_template_versions (template_id,version_number,created_by) VALUES ($1,2,$2)", [t, outroSocio.userId])))).toBe(true);
    expect(await negado(comoSocio((c) => c.query(
      "INSERT INTO checklist_template_versions (template_id,version_number,created_by,status,approved_by,approved_at) VALUES ($1,3,$2,'aprovado',$2,now())", [t, socio.userId])))).toBe(true);
  });

  it('aprovação: exige itens e autoria de quem aprova; depois, versão e itens são imutáveis', async () => {
    const vazio = await novoModelo([]);
    expect(await rejeita(aprovarVersao(vazio.v), /sem itens/)).toBe(true);
    const { v, ids } = await novoModelo([{ kind: 'texto' }, { kind: 'numero' }]);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE checklist_template_versions SET status='aprovado', approved_by=$2, approved_at=now() WHERE id=$1", [v, outroSocio.userId])), /autoria/)).toBe(true);
    await aprovarVersao(v);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE checklist_template_versions SET change_note='mexi' WHERE id=$1", [v])), /imutável/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE checklist_template_items SET label='outro' WHERE id=$1", [ids[0]])), /imutável/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query('DELETE FROM checklist_template_items WHERE id=$1', [ids[0]])), /imutável/)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query('INSERT INTO checklist_template_items (version_id,position,label,kind) VALUES ($1,9,$2,$3)', [v, 'TESTE novo', 'texto'])), /imutável/)).toBe(true);
    expect(await negado(comoSocio((c) => c.query('DELETE FROM checklist_template_versions WHERE id=$1', [v])))).toBe(true);
    await comoSocio((c) => c.query("UPDATE checklist_template_versions SET status='substituido' WHERE id=$1", [v]), true);
    expect(await rejeita(comoSocio((c) => c.query("UPDATE checklist_template_versions SET status='aprovado' WHERE id=$1", [v])), /substituída/)).toBe(true);
  });

  it('rascunho: itens editáveis, posição única, bloqueio exige obrigatório; versão rascunho pode ser excluída com os itens', async () => {
    const { v, ids } = await novoModelo([{ kind: 'texto' }]);
    await comoSocio((c) => c.query("UPDATE checklist_template_items SET label='TESTE editado' WHERE id=$1", [ids[0]]), true);
    expect(await rejeita(comoSocio((c) => c.query('INSERT INTO checklist_template_items (version_id,position,label,kind) VALUES ($1,1,$2,$3)', [v, 'dup', 'texto']), true), /duplicate|unique|duplicad/i)).toBe(true);
    expect(await rejeita(comoSocio((c) => c.query("INSERT INTO checklist_template_items (version_id,position,label,kind,required,blocks_review) VALUES ($1,5,'x','texto',false,true)", [v])), /blocks_chk|check/i)).toBe(true);
    await comoSocio((c) => c.query('DELETE FROM checklist_template_versions WHERE id=$1', [v]), true);
    expect((await db.client.query('SELECT 1 FROM checklist_template_items WHERE id=$1', [ids[0]])).rowCount).toBe(0);
  });

  it('instância: só modelo aprovado, no tenant do rascunho, na carteira Montese; imutável', async () => {
    const rasc = await novoModelo();
    expect(await rejeita(instancia(rasc.v), /aprovado/)).toBe(true);
    const ok = await novoModelo([{ kind: 'sim_nao_na' }], true);
    expect(await rejeita(instancia(ok.v, { tenant: tVinculado.tenantId }), /rascunho inexistente/)).toBe(true);
    expect(await rejeita(instancia(ok.v, { draft: draftVinc, tenant: tVinculado.tenantId }), /rascunho inexistente/)).toBe(true);
    expect(await negado(instancia(ok.v, { by: outroSocio.userId }) as any)).toBe(true);
    const r = await instancia(ok.v);
    expect(r.rows[0].id).toBeTruthy();
    expect(await rejeita(instancia(ok.v), /duplicate|unique/i)).toBe(true); // um por rascunho e versão
    expect(await negado(comoSocio((c) => c.query("UPDATE document_checklists SET company_unit_id=NULL WHERE id=$1", [r.rows[0].id])))).toBe(true);
    expect(await negado(comoSocio((c) => c.query('DELETE FROM document_checklists WHERE id=$1', [r.rows[0].id])))).toBe(true);
    for (const papel of ['empresa', 'tecnico', 'parceiro'] as const) {
      expect((await comoPapel(papel, tecnico.userId, (c) => c.query('SELECT 1 FROM document_checklists'), { tenantId: tMontese.tenantId })).rowCount).toBe(0);
    }
  });

  it('respostas: valor coerente com o tipo do item, item do modelo certo, autoria própria, upsert sem trocar origem', async () => {
    const m = await novoModelo([{ kind: 'sim_nao_na' }, { kind: 'numero' }, { kind: 'data' }, { kind: 'texto' }], true);
    const outro = await novoModelo([{ kind: 'texto' }], true);
    const cl = (await instancia(m.v)).rows[0].id as string;
    expect(await rejeita(responder(cl, m.ids[0], 'talvez'), /sim\/não/)).toBe(true);
    expect((await responder(cl, m.ids[0], 'sim')).rowCount).toBe(1);
    expect(await rejeita(responder(cl, m.ids[1], 'abc'), /numérico/)).toBe(true);
    expect((await responder(cl, m.ids[1], '12,5')).rowCount).toBe(1);
    expect(await rejeita(responder(cl, m.ids[2], '2026-02-31'), /data inválida/)).toBe(true);
    expect(await rejeita(responder(cl, m.ids[2], '01/12/2026'), /data inválida/)).toBe(true);
    expect((await responder(cl, m.ids[2], '2026-12-01')).rowCount).toBe(1);
    expect(await rejeita(responder(cl, outro.ids[0], 'x'), /não pertence/)).toBe(true);
    expect(await negado(responder(cl, m.ids[3], 'x', { by: outroSocio.userId }))).toBe(true);
    expect(await rejeita(responder(cl, m.ids[3], 'x', { tenant: tVinculado.tenantId }), /outro tenant|row-level/i)).toBe(true);
    await comoSocio((c) => c.query("UPDATE document_checklist_answers SET value='nao' WHERE checklist_id=$1 AND item_id=$2", [cl, m.ids[0]]), true);
    expect((await db.client.query('SELECT value FROM document_checklist_answers WHERE checklist_id=$1 AND item_id=$2', [cl, m.ids[0]])).rows[0].value).toBe('nao');
    expect(await rejeita(comoSocio((c) => c.query('UPDATE document_checklist_answers SET item_id=$3 WHERE checklist_id=$1 AND item_id=$2', [cl, m.ids[0], m.ids[3]])), /imutáveis/)).toBe(true);
    expect(await negado(comoSocio((c) => c.query('DELETE FROM document_checklist_answers WHERE checklist_id=$1', [cl])))).toBe(true);
  });

  it('documento cancelado/publicado não aceita checklist nem resposta nova', async () => {
    const m = await novoModelo([{ kind: 'texto' }], true);
    const cl = (await instancia(m.v)).rows[0].id as string;
    await db.client.query('ALTER TABLE document_drafts DISABLE TRIGGER USER');
    try {
      await db.client.query("UPDATE document_drafts SET status='cancelado' WHERE id=$1", [draft]);
      expect(await rejeita(responder(cl, m.ids[0], 'x'), /publicado ou cancelado/)).toBe(true);
      const m2 = await novoModelo([{ kind: 'texto' }], true);
      expect(await rejeita(instancia(m2.v), /publicado ou cancelado/)).toBe(true);
    } finally {
      await db.client.query("UPDATE document_drafts SET status='em_elaboracao' WHERE id=$1", [draft]);
      await db.client.query('ALTER TABLE document_drafts ENABLE TRIGGER USER');
    }
  });

  it('banco impede duas versões aprovadas e dois rascunhos do mesmo modelo', async () => {
    const { t, v } = await novoModelo([{ kind: 'texto' }], true);
    expect(await rejeita(comoSocio((c) => c.query("INSERT INTO checklist_template_versions (template_id, version_number, status, approved_by, approved_at, created_by) VALUES ($1,2,'aprovado',$2,now(),$2)", [t, socio.userId])), /checklist_versions_one_approved_idx|duplicate|violates|created/i)).toBe(true);
    await comoSocio((c) => c.query("INSERT INTO checklist_template_versions (template_id, version_number, created_by) VALUES ($1,2,$2)", [t, socio.userId]), true);
    expect(await rejeita(comoSocio((c) => c.query("INSERT INTO checklist_template_versions (template_id, version_number, created_by) VALUES ($1,3,$2)", [t, socio.userId])), /checklist_versions_one_draft_idx|duplicate/i)).toBe(true);
    expect(v).toBeTruthy();
  });
});
