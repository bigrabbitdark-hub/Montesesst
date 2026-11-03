import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { AVISO_ASSINATURA_INTERNA, MSG_ACAO_NAO_HABILITADA } from '../src/atuacao/documentos/documento-fluxo';
import { TestDb, TestUserFixture } from './db-test-helper';

// O arquivo concentra 3 suítes HTTP no mesmo IP: o limite global (300/5 min) é elevado só neste teste.
process.env.RATE_LIMIT_MAX = '5000';

// Painel de Atuação, Fase 5A, Task 1 (migration 0096): fluxo de documentos (rascunho, versões,
// eventos, assinaturas internas), matriz de responsabilidades, registros profissionais e
// abertura mínima de `documents` para o `socio`. Conexão na role da aplicação (montese_app,
// sujeita a RLS) em transação com set_config local e ROLLBACK. Asserções de dado leem pelo
// superusuário (db.client). NENHUM dado profissional real: conselho 'TESTE', número '0000'.
type Papel = { role: string | null; userId?: string; tenantId?: string };

async function comPapel<T>(p: Papel, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (p.role !== null) {
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.role', $3, true)",
        [p.userId ?? '', p.tenantId ?? '', p.role],
      );
    }
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

// Executa e devolve a mensagem de erro (ou null) e o rowCount.
async function tenta(c: Client, sql: string, p: any[] = []) {
  await c.query('SAVEPOINT s');
  try {
    const r = await c.query(sql, p);
    return { erro: null as string | null, rows: r.rowCount ?? 0 };
  } catch (e: any) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return { erro: String(e.message), rows: 0 };
  }
}
// Mesmo, no superusuário (autocommit).
async function tentaSu(client: Client, sql: string, p: any[] = []) {
  try {
    const r = await client.query(sql, p);
    return { erro: null as string | null, rows: r.rowCount ?? 0 };
  } catch (e: any) {
    return { erro: String(e.message), rows: 0 };
  }
}
const sha = () => createHash('sha256').update(randomUUID()).digest('hex');

const STATUS = ['em_elaboracao', 'em_revisao', 'aprovado', 'assinado', 'publicado', 'cancelado'] as const;
const PERMITIDAS: Record<string, string[]> = {
  em_elaboracao: ['em_revisao', 'cancelado'],
  em_revisao: ['aprovado', 'em_elaboracao', 'cancelado'],
  aprovado: ['assinado', 'em_elaboracao', 'cancelado'],
  assinado: ['publicado', 'em_elaboracao', 'cancelado'],
  publicado: [],
  cancelado: [],
};

describe('atuacao-documentos — fluxo, matriz, registros e documents (e2e de banco)', () => {
  let db: TestDb;
  let socioA: TestUserFixture;
  let socioB: TestUserFixture;
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let comTecnico: { tenantId: string; userId: string };
  let comParceiro: { tenantId: string; userId: string };
  let regA: string; // confirmado, socio A
  let regB: string; // confirmado, socio B
  let regAPend: string; // pendente, socio A
  const sufixo = randomUUID().slice(0, 8);
  const docsCriados: string[] = [];

  const socioCtx = (u: TestUserFixture): Papel => ({ role: 'socio', userId: u.userId });
  const adminCtx = (): Papel => ({ role: 'admin', userId: admin.userId });

  const mkReg = async (userId: string, confirmar: boolean, numero = '0000') => {
    const id = (
      await db.client.query(
        `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by)
         VALUES ($1, 'TESTE', $2, 'SC', $3) RETURNING id`,
        [userId, numero, admin.userId],
      )
    ).rows[0].id as string;
    if (confirmar) {
      await db.client.query(
        "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now() WHERE id = $1",
        [id, admin.userId],
      );
    }
    return id;
  };
  const mkDraft = async (tenantId: string, creator: string, status = 'em_elaboracao', category = 'pgr') =>
    (
      await db.client.query(
        `INSERT INTO document_drafts (tenant_id, category, title, status, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, category, `Rascunho ${sufixo}`, status, creator],
      )
    ).rows[0].id as string;
  const mkVersion = async (draftId: string, tenantId: string, n: number, author: string, hash = sha()) =>
    (
      await db.client.query(
        `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
         VALUES ($1, $2, $3, $4, 'teste.pdf', 'application/pdf', 10, $5, $6) RETURNING id`,
        [draftId, tenantId, n, `drafts/${sufixo}/${randomUUID()}`, hash, author],
      )
    ).rows[0].id as string;
  const mkEvent = async (draftId: string, tenantId: string, actor: string, versionId: string | null = null) =>
    (
      await db.client.query(
        `INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type)
         VALUES ($1, $2, $3, $4, 'created') RETURNING id`,
        [draftId, tenantId, versionId, actor],
      )
    ).rows[0].id as string;
  // Rascunho pronto no estado `status`, com uma versão atual, percorrendo SÓ transições legítimas.
  const CAMINHO: Record<string, string[]> = {
    em_elaboracao: [],
    em_revisao: ['em_revisao'],
    aprovado: ['em_revisao', 'aprovado'],
    assinado: ['em_revisao', 'aprovado', 'assinado'],
    publicado: ['em_revisao', 'aprovado', 'assinado', 'publicado'],
    cancelado: ['cancelado'],
  };
  // Evidência exigida pelos triggers ao entrar em aprovado (evento approved da versão atual) e
  // assinado (assinatura da versão atual, com registro confirmado do signatário).
  const evidencia = async (draftId: string, tenantId: string, para: string) => {
    const v = (await db.client.query('SELECT current_version_id, (SELECT sha256 FROM document_draft_versions WHERE id = current_version_id) AS sha FROM document_drafts WHERE id = $1', [draftId])).rows[0];
    if (para === 'aprovado') {
      await db.client.query("INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type) VALUES ($1,$2,$3,$4,'approved')", [draftId, tenantId, v.current_version_id, socioB.userId]);
    }
    if (para === 'assinado') {
      await db.client.query(
        `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256)
         VALUES ($1,$2,$3,$4,$5,'TESTE','0000','SC',$6)`,
        [draftId, tenantId, v.current_version_id, socioA.userId, regA, v.sha],
      );
    }
  };
  const mkDraftNoEstado = async (tenantId: string, creator: string, status: string) => {
    const id = await mkDraft(tenantId, creator, 'em_elaboracao');
    const v = await mkVersion(id, tenantId, 1, creator);
    await db.client.query('UPDATE document_drafts SET current_version_id = $2 WHERE id = $1', [id, v]);
    for (const st of CAMINHO[status]) {
      if (st === 'publicado') {
        const doc = await mkDocumento(tenantId, creator, 'empresa');
        await db.client.query("UPDATE document_drafts SET status = 'publicado', published_document_id = $2 WHERE id = $1", [id, doc]);
      } else {
        await evidencia(id, tenantId, st);
        await db.client.query('UPDATE document_drafts SET status = $2 WHERE id = $1', [id, st]);
      }
    }
    return { id, versionId: v as string | null };
  };
  const mkDocumento = async (tenantId: string, userId: string, role: string, fileKey?: string, category = 'pgr') => {
    const id = (
      await db.client.query(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, $6, $2, $3, 'teste.pdf', 'application/pdf', 10, $4, $5) RETURNING id`,
        [tenantId, `Doc ${sufixo}`, fileKey ?? `docs/${sufixo}/${randomUUID()}`, userId, role, category],
      )
    ).rows[0].id as string;
    docsCriados.push(id);
    return id;
  };
  // Rascunho 'assinado' (percurso legítimo) e a file_key da sua versão atual.
  const mkAssinado = async (tenantId: string, creator: string, category = 'pgr', semChave = false) => {
    const id = await mkDraft(tenantId, creator, 'em_elaboracao', category);
    const v = await mkVersion(id, tenantId, 1, creator);
    await db.client.query('UPDATE document_drafts SET current_version_id = $2 WHERE id = $1', [id, v]);
    for (const st of ['em_revisao', 'aprovado', 'assinado']) {
      await evidencia(id, tenantId, st);
      await db.client.query('UPDATE document_drafts SET status = $2 WHERE id = $1', [id, st]);
    }
    const versionKey = (await db.client.query('SELECT file_key FROM document_draft_versions WHERE id = $1', [v])).rows[0].file_key as string;
    // documents só aceita a CÓPIA (publish_file_key), nunca a chave da versão; fileKey = chave da cópia
    const fileKey = `tenants/${tenantId}/documents/${randomUUID()}/pub.pdf`;
    if (!semChave) await db.client.query('UPDATE document_drafts SET publish_file_key = $2 WHERE id = $1', [id, fileKey]);
    return { id, fileKey, versionKey };
  };
  const draftRow = async (id: string) =>
    (await db.client.query('SELECT * FROM document_drafts WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socioA = await db.createUserWithRole('socio', 'Socio Docs A');
    socioB = await db.createUserWithRole('socio', 'Socio Docs B');
    admin = await db.createUserWithRole('admin', 'Admin Docs');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Docs');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Docs');
    montese = await db.createTenantWithUser('Cliente Montese Docs');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Docs');
    comParceiro = await db.createTenantWithUser('Cliente Parceiro Docs');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      comTecnico.tenantId,
      tec.rows[0].id,
    ]);
    const par = await db.client.query(
      "INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id",
      [parceiroUser.userId],
    );
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [
      comParceiro.tenantId,
      par.rows[0].id,
    ]);
    regA = await mkReg(socioA.userId, true, '0000');
    regAPend = await mkReg(socioA.userId, false, '0001');
    regB = await mkReg(socioB.userId, true, '0000');
  }, 60000);

  afterAll(async () => {
    // Ordem: rascunhos (cascata nos filhos), documentos, registros/matriz, depois tenants e usuários.
    await db.client.query('DELETE FROM document_drafts WHERE title = $1', [`Rascunho ${sufixo}`]);
    await db.client.query('DELETE FROM document_drafts WHERE tenant_id = ANY($1)', [
      [montese.tenantId, comTecnico.tenantId, comParceiro.tenantId],
    ]);
    if (docsCriados.length) await db.client.query('DELETE FROM documents WHERE id = ANY($1)', [docsCriados]);
    const us = [socioA.userId, socioB.userId, admin.userId];
    await db.client.query('DELETE FROM document_type_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM professional_registrations WHERE user_id = ANY($1) OR created_by = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
  }, 60000);

  it('socio cria rascunho em tenant Montese e lê; não em tenant de técnico; empresa/técnico/parceiro leem 0 linhas', async () => {
    const dMontese = await mkDraft(montese.tenantId, socioB.userId);
    const dTecnico = await mkDraft(comTecnico.tenantId, socioB.userId);
    const vM = await mkVersion(dMontese, montese.tenantId, 1, socioB.userId);
    await mkVersion(dTecnico, comTecnico.tenantId, 1, socioB.userId);
    await mkEvent(dMontese, montese.tenantId, socioB.userId);
    await mkEvent(dTecnico, comTecnico.tenantId, socioB.userId);

    const r = await comPapel(socioCtx(socioA), async (c) => {
      const ok = await tenta(
        c,
        `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', $2, $3)`,
        [montese.tenantId, `Rascunho ${sufixo}`, socioA.userId],
      );
      const emTecnico = await tenta(
        c,
        `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', $2, $3)`,
        [comTecnico.tenantId, `Rascunho ${sufixo}`, socioA.userId],
      );
      const autorAlheio = await tenta(
        c,
        `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', $2, $3)`,
        [montese.tenantId, `Rascunho ${sufixo}`, socioB.userId],
      );
      const nascePublicado = await tenta(
        c,
        `INSERT INTO document_drafts (tenant_id, category, title, status, created_by) VALUES ($1, 'pgr', $2, 'publicado', $3)`,
        [montese.tenantId, `Rascunho ${sufixo}`, socioA.userId],
      );
      const catInvalida = await tenta(
        c,
        `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'xyz', $2, $3)`,
        [montese.tenantId, `Rascunho ${sufixo}`, socioA.userId],
      );
      const lidos = (
        await c.query('SELECT id FROM document_drafts WHERE id = ANY($1)', [[dMontese, dTecnico]])
      ).rows.map((x: any) => x.id);
      const vers = (await c.query('SELECT draft_id FROM document_draft_versions WHERE draft_id = ANY($1)', [[dMontese, dTecnico]])).rows.map((x: any) => x.draft_id);
      const evs = (await c.query('SELECT draft_id FROM document_draft_events WHERE draft_id = ANY($1)', [[dMontese, dTecnico]])).rows.map((x: any) => x.draft_id);
      return { ok, emTecnico, autorAlheio, nascePublicado, catInvalida, lidos, vers, evs };
    });
    expect(r.ok.erro).toBeNull();
    expect(r.emTecnico.erro).not.toBeNull();
    expect(r.autorAlheio.erro).not.toBeNull();
    expect(r.nascePublicado.erro).not.toBeNull();
    expect(r.catInvalida.erro).not.toBeNull();
    expect(r.lidos).toEqual([dMontese]);
    expect(r.vers).toEqual([dMontese]);
    expect(r.evs).toEqual([dMontese]);
    // transação revertida: nada foi persistido pelos INSERTs do sócio; o dado de origem existe nos dois tenants
    const su = await db.client.query('SELECT tenant_id FROM document_drafts WHERE created_by = $1', [socioA.userId]);
    expect(su.rowCount).toBe(0);
    expect((await db.client.query('SELECT count(*)::int AS n FROM document_drafts WHERE id = ANY($1)', [[dMontese, dTecnico]])).rows[0].n).toBe(2);

    // empresa (do próprio tenant Montese), técnico e parceiro leem 0 linhas em todas as 4 tabelas do fluxo
    const tabelas = ['document_drafts', 'document_draft_versions', 'document_draft_events', 'document_draft_signatures'];
    const outros: Papel[] = [
      { role: 'empresa', userId: montese.userId, tenantId: montese.tenantId },
      { role: 'tecnico', userId: tecnicoUser.userId },
      { role: 'parceiro', userId: parceiroUser.userId },
      { role: null },
    ];
    for (const o of outros) {
      for (const t of tabelas) {
        const n = await comPapel(o, async (c) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
        expect([o.role, t, n]).toEqual([o.role, t, 0]);
      }
      // e não escrevem
      const w = await comPapel(o, async (c) =>
        tenta(c, `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', 'x', $2)`, [
          montese.tenantId,
          o.userId ?? montese.userId,
        ]),
      );
      expect(w.erro).not.toBeNull();
    }
    // admin lê, mas não escreve (SELECT apenas)
    const adm = await comPapel(adminCtx(), async (c) => ({
      lidos: (await c.query('SELECT id FROM document_drafts WHERE id = ANY($1)', [[dMontese, dTecnico]])).rowCount,
      ins: await tenta(c, `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1, 'pgr', 'x', $2)`, [montese.tenantId, admin.userId]),
    }));
    expect(adm.lidos).toBe(2);
    expect(adm.ins.erro).not.toBeNull();
    expect(vM).toBeTruthy();
  });

  it('versões, eventos e assinaturas são append-only: UPDATE/DELETE por socio, admin e montese_app falham e a linha fica intacta', async () => {
    const d = await mkDraft(montese.tenantId, socioA.userId);
    const v = await mkVersion(d, montese.tenantId, 1, socioA.userId);
    const e = await mkEvent(d, montese.tenantId, socioA.userId, v);
    const s = (
      await db.client.query(
        `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256)
         VALUES ($1, $2, $3, $4, $5, 'TESTE', '0000', 'SC', (SELECT sha256 FROM document_draft_versions WHERE id = $3)) RETURNING id`,
        [d, montese.tenantId, v, socioA.userId, regA],
      )
    ).rows[0].id as string;
    const estado = async () => ({
      v: (await db.client.query('SELECT file_name, sha256, note, size_bytes FROM document_draft_versions WHERE id = $1', [v])).rows[0],
      e: (await db.client.query('SELECT type, note, actor_user_id FROM document_draft_events WHERE id = $1', [e])).rows[0],
      s: (await db.client.query('SELECT council, version_sha256, ip, user_agent FROM document_draft_signatures WHERE id = $1', [s])).rows[0],
    });
    const antes = await estado();
    const ataques = [
      ["UPDATE document_draft_versions SET file_name = 'x', sha256 = repeat('a',64), note = 'x' WHERE id = $1", v],
      ['DELETE FROM document_draft_versions WHERE id = $1', v],
      ["UPDATE document_draft_events SET type = 'cancelled', note = 'x' WHERE id = $1", e],
      ['DELETE FROM document_draft_events WHERE id = $1', e],
      ["UPDATE document_draft_signatures SET council = 'X', ip = 'x' WHERE id = $1", s],
      ['DELETE FROM document_draft_signatures WHERE id = $1', s],
    ] as const;
    const papeis: Papel[] = [socioCtx(socioA), adminCtx(), { role: null }, { role: 'socio', userId: socioA.userId, tenantId: montese.tenantId }];
    for (const p of papeis) {
      for (const [sql, id] of ataques) {
        const r = await comPapel(p, async (c) => tenta(c, sql, [id]));
        // montese_app: a RLS (sem policy) filtra a linha (0 linhas) ou o trigger levanta exceção; nunca altera
        expect([p.role, sql, r.rows]).toEqual([p.role, sql, 0]);
        expect(await estado()).toEqual(antes);
      }
    }
    // superusuário ignora RLS: o trigger append-only vale também para ele
    for (const [sql, id] of ataques) {
      const r = await tentaSu(db.client, sql, [id]);
      expect([sql, r.erro]).toEqual([sql, expect.stringMatching(/append-only/i)]);
      expect(await estado()).toEqual(antes);
    }
    // cascata legítima (exclusão do rascunho/tenant) continua possível: não é bloqueada pelo trigger
    const dTemp = await mkDraft(montese.tenantId, socioA.userId);
    const vTemp = await mkVersion(dTemp, montese.tenantId, 1, socioA.userId);
    await mkEvent(dTemp, montese.tenantId, socioA.userId, vTemp);
    const del = await tentaSu(db.client, 'DELETE FROM document_drafts WHERE id = $1', [dTemp]);
    expect(del.erro).toBeNull();
    expect((await db.client.query('SELECT count(*)::int AS n FROM document_draft_versions WHERE draft_id = $1', [dTemp])).rows[0].n).toBe(0);
  });

  it('socio não altera tenant_id/created_by do rascunho nem faz transição de status inválida (trigger); rascunho publicado/cancelado é imutável', async () => {
    // (a) colunas imutáveis, pelo socio e pelo superusuário
    const { id } = await mkDraftNoEstado(montese.tenantId, socioA.userId, 'em_elaboracao');
    const antes = await draftRow(id);
    const r = await comPapel(socioCtx(socioA), async (c) => ({
      tenant: await tenta(c, 'UPDATE document_drafts SET tenant_id = $2 WHERE id = $1', [id, comTecnico.tenantId]),
      autor: await tenta(c, 'UPDATE document_drafts SET created_by = $2 WHERE id = $1', [id, socioB.userId]),
      cat: await tenta(c, "UPDATE document_drafts SET category = 'laudo' WHERE id = $1", [id]),
      pula: await tenta(c, "UPDATE document_drafts SET status = 'aprovado' WHERE id = $1", [id]),
      assina: await tenta(c, "UPDATE document_drafts SET status = 'assinado' WHERE id = $1", [id]),
      del: await tenta(c, 'DELETE FROM document_drafts WHERE id = $1', [id]),
      titulo: await tenta(c, "UPDATE document_drafts SET title = 'Novo titulo' WHERE id = $1", [id]),
    }));
    expect(r.tenant.erro).toMatch(/imut/i);
    expect(r.autor.erro).toMatch(/imut/i);
    expect(r.cat.erro).toMatch(/imut/i);
    expect(r.pula.erro).toMatch(/transi/i);
    expect(r.assina.erro).toMatch(/transi/i);
    expect(r.del.rows).toBe(0); // sem policy de DELETE
    expect(r.titulo.erro).toBeNull();
    const depois = await draftRow(id);
    expect({ ...depois, updated_at: 0 }).toEqual({ ...antes, updated_at: 0 }); // transação revertida: nada mudou
    for (const col of ['tenant_id', 'created_by', 'category']) {
      const valor = col === 'tenant_id' ? comTecnico.tenantId : col === 'created_by' ? socioB.userId : 'laudo';
      const su = await tentaSu(db.client, `UPDATE document_drafts SET ${col} = $2 WHERE id = $1`, [id, valor]);
      expect([col, su.erro]).toEqual([col, expect.stringMatching(/imut/i)]);
      expect((await draftRow(id))[col]).toBe(antes[col]);
    }
    // current_version_id deve ser versão do próprio rascunho
    const outro = await mkDraftNoEstado(montese.tenantId, socioA.userId, 'em_elaboracao');
    const cruzada = await tentaSu(db.client, 'UPDATE document_drafts SET current_version_id = $2 WHERE id = $1', [id, outro.versionId]);
    expect(cruzada.erro).toMatch(/vers/i);
    expect((await draftRow(id)).current_version_id).toBe(antes.current_version_id);

    // (b) matriz completa de transições (spec §4): 30 pares, de/para distintos
    const doc = await mkDocumento(montese.tenantId, socioA.userId, 'empresa');
    for (const de of STATUS) {
      for (const para of STATUS) {
        if (de === para) continue;
        const d = await mkDraftNoEstado(montese.tenantId, socioA.userId, de);
        const extra = para === 'publicado' ? ', published_document_id = $3' : '';
        const params: any[] = [d.id, para];
        if (para === 'publicado') params.push(doc);
        // evidência da versão atual (só importa quando a transição é válida)
        if (PERMITIDAS[de].includes(para) && (para === 'aprovado' || para === 'assinado')) await evidencia(d.id, montese.tenantId, para);
        const res = await tentaSu(db.client, `UPDATE document_drafts SET status = $2${extra} WHERE id = $1`, params);
        const esperaOk = PERMITIDAS[de].includes(para);
        expect([de, para, res.erro === null]).toEqual([de, para, esperaOk]);
        expect((await draftRow(d.id)).status).toBe(esperaOk ? para : de);
      }
    }

    // (c) publicado e cancelado são imutáveis (percurso feliz até publicar; cancelamento)
    const pub = await mkDraftNoEstado(montese.tenantId, socioA.userId, 'em_elaboracao');
    for (const st of ['em_revisao', 'aprovado', 'assinado']) {
      await evidencia(pub.id, montese.tenantId, st);
      expect((await tentaSu(db.client, 'UPDATE document_drafts SET status = $2 WHERE id = $1', [pub.id, st])).erro).toBeNull();
    }
    const semDoc = await tentaSu(db.client, "UPDATE document_drafts SET status = 'publicado' WHERE id = $1", [pub.id]);
    expect(semDoc.erro).toMatch(/publica|document/i); // publicar exige published_document_id
    expect((await draftRow(pub.id)).status).toBe('assinado');
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'publicado', published_document_id = $2 WHERE id = $1", [pub.id, doc])).erro).toBeNull();
    const canc = await mkDraftNoEstado(montese.tenantId, socioA.userId, 'em_elaboracao');
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'cancelado' WHERE id = $1", [canc.id])).erro).toBeNull();
    for (const alvo of [pub.id, canc.id]) {
      const base = await draftRow(alvo);
      const v2 = await mkVersion(alvo, montese.tenantId, 2, socioA.userId).catch((e) => String(e.message));
      expect(v2).toMatch(/terminal|publicado|cancelado|imut/i); // nova versão em rascunho terminal é recusada
      for (const sql of [
        "UPDATE document_drafts SET title = 'mudou' WHERE id = $1",
        "UPDATE document_drafts SET status = 'em_elaboracao' WHERE id = $1",
        "UPDATE document_drafts SET current_version_id = NULL WHERE id = $1",
      ]) {
        const x = await tentaSu(db.client, sql, [alvo]);
        expect(x.erro).not.toBeNull();
      }
      const viaSocio = await comPapel(socioCtx(socioA), async (c) => tenta(c, "UPDATE document_drafts SET title = 'mudou' WHERE id = $1", [alvo]));
      expect(viaSocio.erro).toMatch(/imut|termin/i);
      expect(await draftRow(alvo)).toEqual(base);
    }
    // FK ON DELETE SET NULL (apagar o documento publicado) não pode ser bloqueada pela imutabilidade
    const apaga = await tentaSu(db.client, 'DELETE FROM documents WHERE id = $1', [doc]);
    expect(apaga.erro).toBeNull();
    expect((await draftRow(pub.id)).published_document_id).toBeNull();
    expect((await draftRow(pub.id)).status).toBe('publicado');
  });

  it('matriz e registros: socio lê SÓ as próprias linhas e não escreve; admin escreve; registro nasce pendente e só admin confirma', async () => {
    const perm = async (u: string, cat: string, acao: string) =>
      db.client.query(
        'INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ($1,$2,$3,$4)',
        [cat, u, acao, admin.userId],
      );
    await perm(socioA.userId, 'pgr', 'elaborar');
    await perm(socioB.userId, 'pgr', 'revisar');

    const a = await comPapel(socioCtx(socioA), async (c) => ({
      regs: (await c.query('SELECT user_id FROM professional_registrations WHERE user_id = ANY($1)', [[socioA.userId, socioB.userId]])).rows.map((x: any) => x.user_id),
      perms: (await c.query('SELECT user_id FROM document_type_permissions WHERE user_id = ANY($1)', [[socioA.userId, socioB.userId]])).rows.map((x: any) => x.user_id),
      insReg: await tenta(c, `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by) VALUES ($1,'TESTE','9999','SC',$1)`, [socioA.userId]),
      confirma: await tenta(c, "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = user_id, confirmed_at = now() WHERE id = $1", [regAPend]),
      delReg: await tenta(c, 'DELETE FROM professional_registrations WHERE id = $1', [regAPend]),
      insPerm: await tenta(c, `INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('laudo',$1,'publicar',$1)`, [socioA.userId]),
      delPerm: await tenta(c, "DELETE FROM document_type_permissions WHERE user_id = $1", [socioA.userId]),
      updPerm: await tenta(c, "UPDATE document_type_permissions SET action = 'aprovar' WHERE user_id = $1", [socioA.userId]),
    }));
    expect(a.regs.every((u: string) => u === socioA.userId)).toBe(true);
    expect(a.regs.length).toBe(2); // regA (confirmado) + regAPend
    expect(a.perms).toEqual([socioA.userId]);
    expect(a.insReg.erro).not.toBeNull();
    expect(a.confirma.rows).toBe(0);
    expect(a.delReg.rows).toBe(0);
    expect(a.insPerm.erro).not.toBeNull();
    expect(a.delPerm.rows).toBe(0);
    expect(a.updPerm.rows).toBe(0);
    const intactas = await db.client.query(
      'SELECT status FROM professional_registrations WHERE id = $1 UNION ALL SELECT action FROM document_type_permissions WHERE user_id = $2',
      [regAPend, socioA.userId],
    );
    expect(intactas.rows.map((r: any) => r.status)).toEqual(['pendente', 'elaborar']);

    // empresa/técnico/parceiro: 0 linhas
    for (const o of [
      { role: 'empresa', userId: montese.userId, tenantId: montese.tenantId },
      { role: 'tecnico', userId: tecnicoUser.userId },
      { role: 'parceiro', userId: parceiroUser.userId },
    ] as Papel[]) {
      const n = await comPapel(o, async (c) => ({
        r: (await c.query('SELECT 1 FROM professional_registrations')).rowCount,
        p: (await c.query('SELECT 1 FROM document_type_permissions')).rowCount,
      }));
      expect([o.role, n]).toEqual([o.role, { r: 0, p: 0 }]);
    }

    // admin escreve: registro nasce pendente; não nasce confirmado
    const adm = await comPapel(adminCtx(), async (c) => ({
      nasceConfirmado: await tenta(c, `INSERT INTO professional_registrations (user_id, council, registration_number, uf, status, confirmed_by, confirmed_at, created_by) VALUES ($1,'TESTE','7777','SC','confirmado',$2,now(),$2)`, [socioB.userId, admin.userId]),
      ins: await tenta(c, `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by) VALUES ($1,'TESTE','5555','SC',$2)`, [socioB.userId, admin.userId]),
      insPerm: await tenta(c, `INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('laudo',$1,'assinar',$2)`, [socioB.userId, admin.userId]),
      semAutor: await tenta(c, `INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('laudo',$1,'aprovar',$2)`, [socioB.userId, socioB.userId]),
      catInvalida: await tenta(c, `INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('xyz',$1,'assinar',$2)`, [socioB.userId, admin.userId]),
      acaoInvalida: await tenta(c, `INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('laudo',$1,'excluir',$2)`, [socioB.userId, admin.userId]),
      confirma: await tenta(c, "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [regAPend, admin.userId]),
      confirmaPorOutro: await tenta(c, "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [regAPend, socioB.userId]),
    }));
    expect(adm.nasceConfirmado.erro).not.toBeNull();
    expect(adm.ins.erro).toBeNull();
    expect(adm.insPerm.erro).toBeNull();
    expect(adm.semAutor.erro).not.toBeNull();
    expect(adm.catInvalida.erro).not.toBeNull();
    expect(adm.acaoInvalida.erro).not.toBeNull();
    expect(adm.confirma.erro).toBeNull();
    expect(adm.confirmaPorOutro.erro).not.toBeNull();
    expect((await db.client.query('SELECT status FROM professional_registrations WHERE id = $1', [regAPend])).rows[0].status).toBe('pendente'); // rollback

    // máquina de estados do registro (também para o superusuário): pendente→confirmado apenas; resto imutável
    const reg = await mkReg(socioB.userId, false, '1234');
    const autoConf = await tentaSu(db.client, "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = user_id, confirmed_at = now() WHERE id = $1", [reg]);
    expect(autoConf.erro).toMatch(/pr[oó]prio|imut|confirma/i); // ninguém confirma o próprio registro
    expect((await tentaSu(db.client, "UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [reg, admin.userId])).erro).toBeNull();
    const conf = (await db.client.query('SELECT * FROM professional_registrations WHERE id = $1', [reg])).rows[0];
    expect(conf.status).toBe('confirmado');
    for (const sql of [
      "UPDATE professional_registrations SET status = 'pendente', confirmed_by = NULL, confirmed_at = NULL WHERE id = $1",
      "UPDATE professional_registrations SET registration_number = '4321' WHERE id = $1",
      "UPDATE professional_registrations SET council = 'OUTRO' WHERE id = $1",
      "UPDATE professional_registrations SET uf = 'PR' WHERE id = $1",
      'UPDATE professional_registrations SET user_id = (SELECT id FROM users WHERE id <> user_id LIMIT 1) WHERE id = $1',
      'UPDATE professional_registrations SET confirmed_at = now() + interval \'1 day\' WHERE id = $1',
    ]) {
      const x = await tentaSu(db.client, sql, [reg]);
      expect([sql, x.erro]).toEqual([sql, expect.any(String)]);
    }
    expect((await db.client.query('SELECT * FROM professional_registrations WHERE id = $1', [reg])).rows[0]).toEqual(conf);
    // pendente também não troca de identidade
    const pend = await mkReg(socioB.userId, false, '2468');
    const trocaNum = await tentaSu(db.client, "UPDATE professional_registrations SET registration_number = '1357' WHERE id = $1", [pend]);
    expect(trocaNum.erro).toMatch(/imut/i);
    expect((await db.client.query('SELECT registration_number FROM professional_registrations WHERE id = $1', [pend])).rows[0].registration_number).toBe('2468');
  });

  it('assinatura exige registro confirmado do próprio signatário (policy/trigger) e grava hash de 64 hex', async () => {
    const d = await mkDraft(montese.tenantId, socioA.userId, 'aprovado');
    const hash = sha();
    const v = await mkVersion(d, montese.tenantId, 1, socioB.userId, hash);
    const dT = await mkDraft(comTecnico.tenantId, socioA.userId, 'aprovado');
    const vT = await mkVersion(dT, comTecnico.tenantId, 1, socioB.userId, hash);
    const ins = (c: Client, o: { draft?: string; tenant?: string; ver?: string; signer: string; reg: string; sha?: string; council?: string; num?: string; uf?: string }) =>
      tenta(
        c,
        `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'127.0.0.1','jest')`,
        [o.draft ?? d, o.tenant ?? montese.tenantId, o.ver ?? v, o.signer, o.reg, o.council ?? 'TESTE', o.num ?? '0000', o.uf ?? 'SC', o.sha ?? hash],
      );
    const r = await comPapel(socioCtx(socioA), async (c) => ({
      ok: await ins(c, { signer: socioA.userId, reg: regA }),
      pendente: await ins(c, { signer: socioA.userId, reg: regAPend, num: '0001' }),
      deOutro: await ins(c, { signer: socioA.userId, reg: regB }),
      comoOutro: await ins(c, { signer: socioB.userId, reg: regB }),
      shaRuim: await ins(c, { signer: socioA.userId, reg: regA, sha: 'zz' }),
      shaOutro: await ins(c, { signer: socioA.userId, reg: regA, sha: sha() }),
      snapshotRuim: await ins(c, { signer: socioA.userId, reg: regA, num: '9999' }),
      versaoOutroDraft: await ins(c, { signer: socioA.userId, reg: regA, draft: dT, tenant: comTecnico.tenantId, ver: v }),
      tenantTecnico: await ins(c, { signer: socioA.userId, reg: regA, draft: dT, tenant: comTecnico.tenantId, ver: vT }),
    }));
    expect(r.ok.erro).toBeNull();
    expect(r.pendente.erro).not.toBeNull();
    expect(r.deOutro.erro).not.toBeNull();
    expect(r.comoOutro.erro).not.toBeNull();
    expect(r.shaRuim.erro).not.toBeNull();
    expect(r.shaOutro.erro).not.toBeNull();
    expect(r.snapshotRuim.erro).not.toBeNull();
    expect(r.versaoOutroDraft.erro).not.toBeNull();
    expect(r.tenantTecnico.erro).not.toBeNull();
    // admin não assina; nada foi persistido pelo rollback
    const adm = await comPapel(adminCtx(), async (c) => ins(c, { signer: admin.userId, reg: regA }));
    expect(adm.erro).not.toBeNull();
    expect((await db.client.query('SELECT count(*)::int AS n FROM document_draft_signatures WHERE draft_id = ANY($1)', [[d, dT]])).rows[0].n).toBe(0);

    // persistido de verdade (commit), conferido pelo superusuário
    const c2 = new Client({ connectionString: process.env.DATABASE_URL });
    await c2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'socio', true)", [socioA.userId]);
      expect((await ins(c2, { signer: socioA.userId, reg: regA })).erro).toBeNull();
      await c2.query('COMMIT');
    } finally {
      await c2.end();
    }
    const gravada = (await db.client.query('SELECT * FROM document_draft_signatures WHERE draft_id = $1', [d])).rows[0];
    expect(gravada.version_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(gravada.version_sha256).toBe(hash);
    expect(gravada.signer_user_id).toBe(socioA.userId);
    expect(gravada.registration_id).toBe(regA);
    expect([gravada.council, gravada.registration_number, gravada.uf.trim()]).toEqual(['TESTE', '0000', 'SC']);
    // o superusuário também não consegue assinar com registro pendente (CHECK/trigger no banco, não só policy)
    const su = await tentaSu(
      db.client,
      `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256)
       VALUES ($1,$2,$3,$4,$5,'TESTE','0001','SC',$6)`,
      [d, montese.tenantId, v, socioA.userId, regAPend, hash],
    );
    expect(su.erro).toMatch(/confirmado/i);
    expect((await db.client.query('SELECT count(*)::int AS n FROM document_draft_signatures WHERE draft_id = $1', [d])).rows[0].n).toBe(1);
  });

  it('documents aceita uploaded_by_role socio; socio insere/lê documents só de tenant Montese; não atualiza nem apaga; empresa continua vendo só o próprio tenant', async () => {
    const dTecnico = await mkDocumento(comTecnico.tenantId, comTecnico.userId, 'empresa');
    const dMontese = await mkDocumento(montese.tenantId, montese.userId, 'empresa');
    const assinado = await mkAssinado(montese.tenantId, socioA.userId);
    const assinado2 = await mkAssinado(montese.tenantId, socioA.userId);
    const dSocioSu = await mkDocumento(montese.tenantId, socioA.userId, 'socio', assinado.fileKey); // CHECK aceita 'socio' (a partir de rascunho assinado)
    expect((await db.client.query('SELECT uploaded_by_role FROM documents WHERE id = $1', [dSocioSu])).rows[0].uploaded_by_role).toBe('socio');
    const ins = (c: Client, tenant: string, user: string, role = 'socio', fileKey?: string) =>
      tenta(
        c,
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1,'pgr',$2,$3,'teste.pdf','application/pdf',10,$4,$5)`,
        [tenant, `Doc ${sufixo}`, fileKey ?? `docs/${sufixo}/${randomUUID()}`, user, role],
      );
    const r = await comPapel(socioCtx(socioA), async (c) => ({
      ok: await ins(c, montese.tenantId, socioA.userId, 'socio', assinado2.fileKey),
      emTecnico: await ins(c, comTecnico.tenantId, socioA.userId, 'socio', assinado2.fileKey),
      emParceiro: await ins(c, comParceiro.tenantId, socioA.userId, 'socio', assinado2.fileKey),
      autorAlheio: await ins(c, montese.tenantId, socioB.userId, 'socio', assinado2.fileKey),
      papelErrado: await ins(c, montese.tenantId, socioA.userId, 'empresa', assinado2.fileKey),
      lidos: (await c.query('SELECT id FROM documents WHERE id = ANY($1) ORDER BY id', [[dTecnico, dMontese, dSocioSu]])).rows.map((x: any) => x.id).sort(),
      upd: await tenta(c, "UPDATE documents SET title = 'mudou' WHERE id = ANY($1)", [[dMontese, dSocioSu, dTecnico]]),
      del: await tenta(c, 'DELETE FROM documents WHERE id = ANY($1)', [[dMontese, dSocioSu, dTecnico]]),
    }));
    expect(r.ok.erro).toBeNull();
    expect(r.emTecnico.erro).not.toBeNull();
    expect(r.emParceiro.erro).not.toBeNull();
    expect(r.autorAlheio.erro).not.toBeNull();
    expect(r.papelErrado.erro).not.toBeNull();
    expect(r.lidos).toEqual([dMontese, dSocioSu].sort());
    expect(r.upd.rows).toBe(0);
    expect(r.del.rows).toBe(0);
    const intactos = await db.client.query('SELECT title FROM documents WHERE id = ANY($1)', [[dMontese, dSocioSu, dTecnico]]);
    expect(intactos.rowCount).toBe(3);
    expect(intactos.rows.every((x: any) => x.title === `Doc ${sufixo}`)).toBe(true);
    // empresa continua vendo só o próprio tenant
    const emp = await comPapel({ role: 'empresa', userId: montese.userId, tenantId: montese.tenantId }, async (c) =>
      (await c.query('SELECT id FROM documents WHERE id = ANY($1)', [[dTecnico, dMontese, dSocioSu]])).rows.map((x: any) => x.id).sort(),
    );
    expect(emp).toEqual([dMontese, dSocioSu].sort());
    const empT = await comPapel({ role: 'empresa', userId: comTecnico.userId, tenantId: comTecnico.tenantId }, async (c) =>
      (await c.query('SELECT id FROM documents WHERE id = ANY($1)', [[dTecnico, dMontese, dSocioSu]])).rows.map((x: any) => x.id),
    );
    expect(empT).toEqual([dTecnico]);
    // outros papéis sem vínculo continuam sem ver os documentos Montese
    const par = await comPapel({ role: 'parceiro', userId: parceiroUser.userId }, async (c) =>
      (await c.query('SELECT id FROM documents WHERE id = ANY($1)', [[dMontese, dSocioSu]])).rowCount,
    );
    expect(par).toBe(0);
    // categorias: mesmo domínio já existente (relatorio_visita incluso)
    const cats = await db.client.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname IN ('documents_category_check') AND conrelid = 'documents'::regclass");
    expect(cats.rows[0].d).toContain('relatorio_visita');
  });

  it('documents: inserção de socio só a partir de rascunho assinado (mesmo tenant, categoria e file_key); demais papéis não são afetados', async () => {
    const ass = await mkAssinado(montese.tenantId, socioA.userId, 'laudo');
    const apr = await mkDraft(montese.tenantId, socioA.userId, 'em_elaboracao', 'laudo');
    const vApr = await mkVersion(apr, montese.tenantId, 1, socioA.userId);
    await db.client.query('UPDATE document_drafts SET current_version_id = $2 WHERE id = $1', [apr, vApr]);
    for (const st of ['em_revisao', 'aprovado']) {
      await evidencia(apr, montese.tenantId, st);
      await db.client.query('UPDATE document_drafts SET status = $2 WHERE id = $1', [apr, st]);
    }
    const keyApr = (await db.client.query('SELECT file_key FROM document_draft_versions WHERE id = $1', [vApr])).rows[0].file_key as string;
    const contagem = async (fk: string) =>
      (await db.client.query('SELECT count(*)::int AS n FROM documents WHERE file_key = $1', [fk])).rows[0].n;
    const ins = (c: Client, o: { tenant?: string; cat?: string; key: string; user?: string }) =>
      tenta(
        c,
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1,$2,$3,$4,'teste.pdf','application/pdf',10,$5,'socio')`,
        [o.tenant ?? montese.tenantId, o.cat ?? 'laudo', `Doc ${sufixo}`, o.key, o.user ?? socioA.userId],
      );
    const semRascunho = `docs/${sufixo}/sem-${randomUUID()}`;
    const r = await comPapel(socioCtx(socioA), async (c) => ({
      sem: await ins(c, { key: semRascunho }),
      aprovado: await ins(c, { key: keyApr }),
      catOutra: await ins(c, { key: ass.fileKey, cat: 'pgr' }),
      keyOutra: await ins(c, { key: ass.fileKey + 'x' }),
      tenantOutro: await ins(c, { key: ass.fileKey, tenant: comTecnico.tenantId }),
      ok: await ins(c, { key: ass.fileKey }),
    }));
    expect(r.sem.erro).toMatch(/rascunho assinado/);
    expect(r.aprovado.erro).toMatch(/rascunho assinado/);
    expect(r.catOutra.erro).toMatch(/rascunho assinado/);
    expect(r.keyOutra.erro).toMatch(/rascunho assinado/);
    expect(r.tenantOutro.erro).not.toBeNull();
    expect(r.ok.erro).toBeNull();
    // erros não criaram linha (e o ok foi revertido pelo ROLLBACK)
    expect(await contagem(semRascunho)).toBe(0);
    expect(await contagem(keyApr)).toBe(0);
    expect(await contagem(ass.fileKey)).toBe(0);
    // superusuário também é barrado, com ERRCODE 42501
    const su = await db.client.query('SELECT 1').then(async () => {
      try {
        await db.client.query(
          `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
           VALUES ($1,'laudo','x',$2,'t.pdf','application/pdf',10,$3,'socio')`,
          [montese.tenantId, semRascunho, socioA.userId],
        );
        return null;
      } catch (e: any) {
        return e.code as string;
      }
    });
    expect(su).toBe('42501');
    // regressão: empresa, técnico, parceiro e admin (contexto de cada papel e superusuário) inserem normalmente
    const base = (c: Client, tenant: string, user: string, role: string, key: string) =>
      tenta(
        c,
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1,'pgr',$2,$3,'teste.pdf','application/pdf',10,$4,$5)`,
        [tenant, `Doc ${sufixo}`, key, user, role],
      );
    const k = () => `docs/${sufixo}/reg-${randomUUID()}`;
    const emp = await comPapel({ role: 'empresa', userId: montese.userId, tenantId: montese.tenantId }, (c) => base(c, montese.tenantId, montese.userId, 'empresa', k()));
    const tec = await comPapel({ role: 'tecnico', userId: tecnicoUser.userId }, (c) => base(c, comTecnico.tenantId, tecnicoUser.userId, 'tecnico', k()));
    const par = await comPapel({ role: 'parceiro', userId: parceiroUser.userId }, (c) => base(c, comParceiro.tenantId, parceiroUser.userId, 'parceiro', k()));
    const adm = await comPapel(adminCtx(), (c) => base(c, montese.tenantId, montese.userId, 'empresa', k()));
    expect([emp.erro, tec.erro, par.erro, adm.erro]).toEqual([null, null, null, null]);
    for (const role of ['empresa', 'tecnico', 'parceiro']) {
      const id = await mkDocumento(montese.tenantId, montese.userId, role);
      expect(id).toBeTruthy();
    }
  });

  it('publish_file_key: definida uma vez, só com rascunho assinado; documents aceita SÓ a publish_file_key (nunca a chave da versão nem chave arbitrária)', async () => {
    const ass = await mkAssinado(montese.tenantId, socioA.userId, 'laudo', true);
    const copia = `tenants/${montese.tenantId}/documents/${randomUUID()}/copia.pdf`;
    const elab = await mkDraft(montese.tenantId, socioA.userId, 'em_elaboracao', 'laudo');
    expect((await tentaSu(db.client, 'UPDATE document_drafts SET publish_file_key = $2 WHERE id = $1', [elab, copia])).erro).toMatch(/publish_file_key/);
    const insDoc = (c: Client, key: string) =>
      tenta(c, `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
                VALUES ($1,'laudo',$2,$3,'t.pdf','application/pdf',10,$4,'socio')`, [montese.tenantId, `Doc ${sufixo}`, key, socioA.userId]);
    const antes = await comPapel(socioCtx(socioA), async (c) => ({ copia: await insDoc(c, copia), versao: await insDoc(c, ass.versionKey) }));
    expect(antes.copia.erro).toMatch(/rascunho assinado/); // ainda sem publish_file_key
    expect(antes.versao.erro).toMatch(/rascunho assinado/);
    expect((await tentaSu(db.client, 'UPDATE document_drafts SET publish_file_key = $2 WHERE id = $1', [ass.id, copia])).erro).toBeNull();
    const depois = await comPapel(socioCtx(socioA), async (c) => ({
      copia: await insDoc(c, copia), versao: await insDoc(c, ass.versionKey), arbitraria: await insDoc(c, `${copia}x`),
    }));
    expect(depois.copia.erro).toBeNull();
    expect(depois.versao.erro).toMatch(/rascunho assinado/); // a chave da versão nunca é compartilhada com documents
    expect(depois.arbitraria.erro).toMatch(/rascunho assinado/);
    for (const v of ['outra/chave', null]) {
      const x = await tentaSu(db.client, 'UPDATE document_drafts SET publish_file_key = $2 WHERE id = $1', [ass.id, v]);
      expect(x.erro).toMatch(/publish_file_key/);
    }
    expect((await draftRow(ass.id)).publish_file_key).toBe(copia);
    const doc = await mkDocumento(montese.tenantId, socioA.userId, 'empresa');
    await db.client.query("UPDATE document_drafts SET status = 'publicado', published_document_id = $2 WHERE id = $1", [ass.id, doc]);
    expect((await tentaSu(db.client, "UPDATE document_drafts SET publish_file_key = 'z' WHERE id = $1", [ass.id])).erro).not.toBeNull();
  });

  it('triggers de evidência: aprovado exige evento approved e assinado exige assinatura da VERSÃO ATUAL; revogação de registro é terminal; signed_at usa clock_timestamp', async () => {
    const d = await mkDraftNoEstado(montese.tenantId, socioA.userId, 'em_revisao');
    const semEvento = await tentaSu(db.client, "UPDATE document_drafts SET status = 'aprovado' WHERE id = $1", [d.id]);
    expect(semEvento.erro).toMatch(/approved/);
    // evento de OUTRA versão não vale
    const v2 = await mkVersion(d.id, montese.tenantId, 2, socioA.userId);
    await db.client.query("INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type) VALUES ($1,$2,$3,$4,'approved')", [d.id, montese.tenantId, v2, socioB.userId]);
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'aprovado' WHERE id = $1", [d.id])).erro).toMatch(/approved/);
    await evidencia(d.id, montese.tenantId, 'aprovado');
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'aprovado' WHERE id = $1", [d.id])).erro).toBeNull();
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'assinado' WHERE id = $1", [d.id])).erro).toMatch(/assinatura/);
    await evidencia(d.id, montese.tenantId, 'assinado');
    expect((await tentaSu(db.client, "UPDATE document_drafts SET status = 'assinado' WHERE id = $1", [d.id])).erro).toBeNull();
    const sig = (await db.client.query('SELECT signed_at FROM document_draft_signatures WHERE draft_id = $1', [d.id])).rows[0];
    expect(sig.signed_at).toBeInstanceOf(Date);
    const def = await db.client.query("SELECT column_default FROM information_schema.columns WHERE table_name='document_draft_signatures' AND column_name='signed_at'");
    expect(def.rows[0].column_default).toMatch(/clock_timestamp/);

    // revogação: confirmado -> revogado (admin); revogado terminal; pendente não revoga; registro revogado não assina
    const reg = await mkReg(socioB.userId, true, '8888');
    const pend = await mkReg(socioB.userId, false, '8889');
    const rev = (id: string, by: string) => tentaSu(db.client, "UPDATE professional_registrations SET status='revogado', revoked_by=$2, revoked_at=now() WHERE id=$1", [id, by]);
    expect((await rev(pend, admin.userId)).erro).toMatch(/confirmado/);
    expect((await rev(reg, admin.userId)).erro).toBeNull();
    const r = (await db.client.query('SELECT status, confirmed_by, revoked_by FROM professional_registrations WHERE id=$1', [reg])).rows[0];
    expect(r).toMatchObject({ status: 'revogado', confirmed_by: admin.userId, revoked_by: admin.userId });
    for (const sql of [
      "UPDATE professional_registrations SET status='confirmado', revoked_by=NULL, revoked_at=NULL WHERE id=$1",
      "UPDATE professional_registrations SET status='pendente', confirmed_by=NULL, confirmed_at=NULL, revoked_by=NULL, revoked_at=NULL WHERE id=$1",
      "UPDATE professional_registrations SET revoked_at = now() + interval '1 day' WHERE id=$1",
    ]) expect((await tentaSu(db.client, sql, [reg])).erro).not.toBeNull();
    const sigRev = await tentaSu(
      db.client,
      `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256)
       VALUES ($1,$2,$3,$4,$5,'TESTE','8888','SC',(SELECT sha256 FROM document_draft_versions WHERE id = $3))`,
      [d.id, montese.tenantId, d.versionId, socioB.userId, reg],
    );
    expect(sigRev.erro).toMatch(/confirmado/);
    // revogar pela role admin sob RLS
    const reg2 = await mkReg(socioB.userId, true, '8890');
    const viaAdmin = await comPapel(adminCtx(), async (c) => tenta(c, "UPDATE professional_registrations SET status='revogado', revoked_by=$2, revoked_at=now() WHERE id=$1", [reg2, admin.userId]));
    expect(viaAdmin.erro).toBeNull();
    const viaSocio = await comPapel(socioCtx(socioB), async (c) => tenta(c, "UPDATE professional_registrations SET status='revogado', revoked_by=$2, revoked_at=now() WHERE id=$1", [reg2, socioB.userId]));
    expect(viaSocio.rows).toBe(0);
  });

  it('CHECK de socio_permissions aceita documents.read|approve|publish e rejeita valores fora da lista (14 itens)', async () => {
    for (const p of ['documents.read', 'documents.approve', 'documents.publish', 'documents.cancel', 'documents.view_registration']) {
      const x = await tentaSu(db.client, 'INSERT INTO socio_permissions (user_id, permission) VALUES ($1, $2)', [socioB.userId, p]);
      expect([p, x.erro]).toEqual([p, null]);
    }
    for (const p of ['documents.delete', 'finance.write', 'documents', '']) {
      const x = await tentaSu(db.client, 'INSERT INTO socio_permissions (user_id, permission) VALUES ($1, $2)', [socioB.userId, p]);
      expect([p, x.erro]).toEqual([p, expect.stringMatching(/check/i)]);
    }
    // as 9 permissões anteriores continuam válidas
    for (const p of ['clients.read', 'clients.update_operational', 'tasks.read', 'tasks.write', 'appointments.manage', 'documents.create_draft', 'documents.review', 'documents.sign', 'finance.read']) {
      const x = await tentaSu(db.client, 'INSERT INTO socio_permissions (user_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING', [socioB.userId, p]);
      expect([p, x.erro]).toEqual([p, null]);
    }
    const n = await db.client.query('SELECT count(*)::int AS n FROM socio_permissions WHERE user_id = $1', [socioB.userId]);
    expect(n.rows[0].n).toBe(14);
  });
});

// ---------------------------------------------------------------------------------------------
// Fase 5A, Task 3: fluxo HTTP do sócio (rotas /atuacao/documentos), com R2 FAKE em memória.
// Matriz e registros semeados via db.client (a API de admin é a Task 4). NENHUM dado profissional
// real: conselho 'TESTE', número '0000'.
// ---------------------------------------------------------------------------------------------
describe('atuacao-documentos — fluxo HTTP do sócio (R2 fake)', () => {
  const CAT = 'laudo';
  const RBAC = ['documents.read', 'documents.create_draft', 'documents.review', 'documents.approve', 'documents.sign', 'documents.publish', 'documents.cancel'];
  const PDF = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
  const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const sufixo = randomUUID().slice(0, 8);
  const TITULO = `Titulo-Secreto-${sufixo}`;
  const NOTA = `Nota-Secreta-${sufixo}`;

  let app: INestApplication;
  let db: TestDb;
  let A: TestUserFixture, B: TestUserFixture, C: TestUserFixture, E: TestUserFixture, F: TestUserFixture, G: TestUserFixture, H: TestUserFixture;
  let admin: TestUserFixture, tecnicoUser: TestUserFixture, parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let comTecnico: { tenantId: string; userId: string };
  let regB: string;
  let regG: string;
  let tG: string;
  let tH: string;
  let tA: string, tB: string, tC: string, tE: string, tF: string, tAdmin: string, tTec: string, tPar: string, tEmp: string;
  const r2 = new Map<string, { body: Buffer; mime: string }>();
  const r2Fake = {
    putObject: jest.fn(async (key: string, body: Buffer, mime: string) => { r2.set(key, { body, mime }); }),
    deleteObject: jest.fn(async (key: string) => { r2.delete(key); }),
    getObject: jest.fn(async (key: string) => r2.get(key)!.body),
    getPresignedDownloadUrl: jest.fn(async (key: string) => `https://r2.fake/${key}?assinado=1`),
  };

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const base = '/atuacao/documentos';
  const get = (t: string, path: string) => request(app.getHttpServer()).get(`${base}${path}`).set(auth(t));
  const post = (t: string, path: string, body: object = {}) => request(app.getHttpServer()).post(`${base}${path}`).set(auth(t)).send(body);
  const upload = (t: string, id: string, buf: Buffer, o: { mime?: string; nome?: string; nota?: string } = {}) => {
    const r = request(app.getHttpServer()).post(`${base}/${id}/versoes`).set(auth(t)).set('User-Agent', 'jest-ua')
      .attach('file', buf, { filename: o.nome ?? 'laudo teste.pdf', contentType: o.mime ?? 'application/pdf' });
    return o.nota ? r.field('note', o.nota) : r;
  };

  const mkReg = async (userId: string, confirmar: boolean) => {
    const id = (await db.client.query(
      `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by) VALUES ($1,'TESTE','0000','SC',$2) RETURNING id`,
      [userId, admin.userId],
    )).rows[0].id as string;
    if (confirmar) {
      await db.client.query("UPDATE professional_registrations SET status='confirmado', confirmed_by=$2, confirmed_at=now() WHERE id=$1", [id, admin.userId]);
    }
    return id;
  };
  const matriz = (userId: string, acoes: string[], cat = CAT) =>
    Promise.all(acoes.map((a) => db.client.query(
      'INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ($1,$2,$3,$4)', [cat, userId, a, admin.userId])));
  const rbac = (userId: string) => Promise.all(RBAC.map((p) => db.grantSocioPermission(userId, p)));

  // Rascunho semeado (superusuário) no estado pedido, com uma versão escrita por `autor`.
  const semear = async (tenantId: string, autor: string, status: string, o: { cat?: string; assinarCom?: string; criador?: string; anteriores?: string[]; submeteu?: string } = {}) => {
    const id = (await db.client.query(
      `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantId, o.cat ?? CAT, TITULO, o.criador ?? autor],
    )).rows[0].id as string;
    // versões anteriores (autores antigos); a versão atual é sempre a última
    for (const [i, antigo] of (o.anteriores ?? []).entries()) {
      const c = PDF(`antiga-${i}-${randomUUID()}`);
      const vid = (await db.client.query(
        `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
         VALUES ($1,$2,$3,$4,'antiga.pdf','application/pdf',$5,$6,$7) RETURNING id`,
        [id, tenantId, i + 1, `documents-fluxo/${tenantId}/${id}/${randomUUID()}`, c.length, sha256(c), antigo],
      )).rows[0].id as string;
      await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [id, vid]);
    }
    const nAnt = (o.anteriores ?? []).length;
    const corpo = PDF(`semente-${randomUUID()}`);
    const fileKey = `documents-fluxo/${tenantId}/${id}/1-${randomUUID()}`;
    const hash = sha256(corpo);
    r2.set(fileKey, { body: corpo, mime: 'application/pdf' });
    const versionId = (await db.client.query(
      `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
       VALUES ($1,$2,$7,$3,'semente.pdf','application/pdf',$4,$5,$6) RETURNING id`,
      [id, tenantId, fileKey, corpo.length, hash, autor, nAnt + 1],
    )).rows[0].id as string;
    await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [id, versionId]);
    const caminho: Record<string, string[]> = {
      em_elaboracao: [], em_revisao: ['em_revisao'], aprovado: ['em_revisao', 'aprovado'], assinado: ['em_revisao', 'aprovado', 'assinado'],
    };
    for (const st of caminho[status]) {
      if (st === 'em_revisao' && o.submeteu) {
        await db.client.query("INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type) VALUES ($1,$2,$3,$4,'submitted')", [id, tenantId, versionId, o.submeteu]);
      }
      if (st === 'aprovado') {
        await db.client.query("INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type) VALUES ($1,$2,$3,$4,'approved')", [id, tenantId, versionId, B.userId]);
      }
      if (st === 'assinado') {
        // os triggers exigem a assinatura da versão atual (registro confirmado de B) antes de assinar
        await db.client.query(
          `INSERT INTO document_draft_signatures (draft_id, tenant_id, version_id, signer_user_id, registration_id, council, registration_number, uf, version_sha256)
           VALUES ($1,$2,$3,$4,$5,'TESTE','0000','SC',$6)`,
          [id, tenantId, versionId, B.userId, regB, hash],
        );
      }
      await db.client.query('UPDATE document_drafts SET status=$2 WHERE id=$1', [id, st]);
    }
    void o.assinarCom;
    return { id, versionId, fileKey, hash };
  };
  const draft = async (id: string) => (await db.client.query('SELECT * FROM document_drafts WHERE id=$1', [id])).rows[0];
  const eventos = async (id: string) =>
    (await db.client.query('SELECT type, actor_user_id, note, version_id FROM document_draft_events WHERE draft_id=$1 ORDER BY created_at, id', [id])).rows;
  const versoes = async (id: string) =>
    (await db.client.query('SELECT * FROM document_draft_versions WHERE draft_id=$1 ORDER BY version_number', [id])).rows;
  const nSig = async (id: string) =>
    (await db.client.query('SELECT count(*)::int AS n FROM document_draft_signatures WHERE draft_id=$1', [id])).rows[0].n;
  const nDocs = async (tenantId: string) =>
    (await db.client.query("SELECT count(*)::int AS n FROM documents WHERE tenant_id=$1 AND uploaded_by_role='socio'", [tenantId])).rows[0].n;
  const auditorias = async (userIds: string[], esperaMin: number) => {
    let r: any[] = [];
    for (let i = 0; i < 40; i++) {
      r = (await db.client.query(
        "SELECT action, resource_type, resource_id, method, path, status_code, detail FROM audit_log WHERE actor_user_id = ANY($1) AND action LIKE 'document_draft.%' ORDER BY occurred_at", [userIds])).rows;
      if (r.length >= esperaMin) break;
      await new Promise((x) => setTimeout(x, 100));
    }
    return r;
  };
  const semAviso = (o: unknown) => JSON.stringify(o).split(AVISO_ASSINATURA_INTERNA).join('');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue(r2Fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    A = await db.createUserWithRole('socio', 'Socio Fluxo A');
    B = await db.createUserWithRole('socio', 'Socio Fluxo B');
    C = await db.createUserWithRole('socio', 'Socio Fluxo C');
    E = await db.createUserWithRole('socio', 'Socio Fluxo E');
    F = await db.createUserWithRole('socio', 'Socio Fluxo F');
    G = await db.createUserWithRole('socio', 'Socio Fluxo G');
    H = await db.createUserWithRole('socio', 'Socio Fluxo H');
    admin = await db.createUserWithRole('admin', 'Admin Fluxo');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Fluxo');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Fluxo');
    montese = await db.createTenantWithUser('Cliente Montese Fluxo');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Fluxo');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [comTecnico.tenantId, tec.rows[0].id]);
    const par = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id", [parceiroUser.userId]);
    const comParceiro = await db.createTenantWithUser('Cliente Parceiro Fluxo');
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [comParceiro.tenantId, par.rows[0].id]);

    for (const u of [A, B, E, G, H]) await rbac(u.userId);
    // C: tudo, MENOS documents.cancel
    for (const p of RBAC.filter((x) => x !== 'documents.cancel')) await db.grantSocioPermission(C.userId, p);
    // só quem tem documents.view_registration vê conselho/número/UF no JSON do fluxo
    for (const u of [B, G, H]) await db.grantSocioPermission(u.userId, 'documents.view_registration');
    await matriz(H.userId, ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar']);
    await mkReg(H.userId, true);
    await matriz(G.userId, ['assinar']);
    await matriz(A.userId, ['elaborar']);
    await matriz(B.userId, ['revisar', 'aprovar', 'assinar', 'publicar']);
    await matriz(C.userId, ['elaborar', 'assinar']);
    regB = await mkReg(B.userId, true);
    await mkReg(C.userId, false);
    regG = await mkReg(G.userId, true);

    [tA, tB, tC, tE, tF, tAdmin, tTec, tPar, tEmp, tG] = await Promise.all([
      login(A), login(B), login(C), login(E), login(F), login(admin), login(tecnicoUser), login(parceiroUser), login(montese), login(G),
    ]);
    tH = await login(H);
  }, 60000);

  afterAll(async () => {
    const us = [A.userId, B.userId, C.userId, E.userId, F.userId, G.userId, H.userId, admin.userId];
    await db.client.query('DELETE FROM document_drafts WHERE tenant_id = ANY($1)', [[montese.tenantId, comTecnico.tenantId]]);
    await db.client.query("DELETE FROM documents WHERE tenant_id = ANY($1) AND uploaded_by_role = 'socio'", [[montese.tenantId, comTecnico.tenantId]]);
    await db.client.query('DELETE FROM document_type_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM professional_registrations WHERE user_id = ANY($1) OR created_by = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('fluxo feliz: A elabora e envia; B devolve com nota; A envia nova versão; B aprova, assina e publica (estado, evento, hash, snapshot e documents)', async () => {
    // A cria o rascunho
    const c = await post(tA, '', { tenant_id: montese.tenantId, category: CAT, title: TITULO });
    expect(c.status).toBe(201);
    const id = c.body.id as string;
    expect(c.body.status).toBe('em_elaboracao');
    expect(c.body.acoes_permitidas).toEqual(expect.arrayContaining(['nova_versao', 'cancelar']));
    expect(c.body.aviso_assinatura).toBe(AVISO_ASSINATURA_INTERNA);
    expect((await draft(id)).created_by).toBe(A.userId);

    // versão 1: hash calculado no servidor, chave documents-fluxo, objeto no R2 fake
    const buf1 = PDF('v1');
    const v1 = await upload(tA, id, buf1, { nota: NOTA });
    expect(v1.status).toBe(201);
    const rows1 = await versoes(id);
    expect(rows1).toHaveLength(1);
    expect(rows1[0].sha256).toBe(sha256(buf1));
    expect(rows1[0].file_key).toMatch(new RegExp(`^documents-fluxo/${montese.tenantId}/${id}/[0-9a-f-]{36}$`));
    expect(rows1[0].created_by).toBe(A.userId);
    expect(r2.get(rows1[0].file_key)!.body.equals(buf1)).toBe(true);
    expect((await draft(id)).current_version_id).toBe(rows1[0].id);
    expect(v1.body.versoes[0]).not.toHaveProperty('file_key');

    // A envia à revisão; A não devolve (sem 'revisar' na matriz) e não aprova
    expect((await post(tA, `/${id}/enviar-revisao`)).status).toBe(201);
    expect((await draft(id)).status).toBe('em_revisao');
    const aDev = await post(tA, `/${id}/devolver`, { note: NOTA });
    expect(aDev.status).toBe(403);
    expect(aDev.body.message).toBe(MSG_ACAO_NAO_HABILITADA);
    expect((await post(tA, `/${id}/aprovar`)).status).toBe(403);

    // B devolve (nota obrigatória)
    expect((await post(tB, `/${id}/devolver`, {})).status).toBe(400);
    const dev = await post(tB, `/${id}/devolver`, { note: NOTA });
    expect(dev.status).toBe(201);
    expect((await draft(id)).status).toBe('em_elaboracao');

    // A envia a versão 2 e reenvia
    const buf2 = PDF('v2');
    expect((await upload(tA, id, buf2)).status).toBe(201);
    const rows2 = await versoes(id);
    expect(rows2.map((r: any) => r.version_number)).toEqual([1, 2]);
    expect(rows2[1].sha256).toBe(sha256(buf2));
    expect(rows2[1].sha256).not.toBe(rows2[0].sha256);
    expect((await post(tA, `/${id}/enviar-revisao`)).status).toBe(201);

    // E2: a devolução abriu uma correção; enquanto não for corrigida E verificada, aprovar é bloqueado (409, nada muda)
    const detCorr = await (request(app.getHttpServer()) as any).get(`${base}/${id}`).set(auth(tB));
    expect(detCorr.body.correcoes).toHaveLength(1);
    expect(detCorr.body.correcoes[0]).toMatchObject({ status: 'aberta', origin: 'revisao', description: NOTA });
    expect(detCorr.body.correcoes_pendentes).toBe(1);
    const bloq = await post(tB, `/${id}/aprovar`);
    expect(bloq.status).toBe(409);
    expect((await draft(id)).status).toBe('em_revisao');
    const corrId = detCorr.body.correcoes[0].id as string;
    const patch = (t: string, body: object) => (request(app.getHttpServer()) as any).patch(`${base}/${id}/correcoes/${corrId}`).set(auth(t)).send(body);
    expect((await patch(tA, { acao: 'corrigir', nota: 'item 3 ajustado' })).status).toBe(200);
    expect((await post(tB, `/${id}/aprovar`)).status).toBe(409); // corrigida ainda não é verificada
    expect((await patch(tB, { acao: 'verificar' })).status).toBe(200);

    // B (que não é autor) aprova: a mesma transição em_revisao -> aprovado
    const apr = await post(tB, `/${id}/aprovar`);
    expect(apr.status).toBe(201);
    expect((await draft(id)).status).toBe('aprovado');
    expect(apr.body.acoes_permitidas).toEqual(['assinar']);

    // B assina: snapshot do registro confirmado + hash da versão ATUAL + IP e user-agent
    const ass = await request(app.getHttpServer()).post(`${base}/${id}/assinar`).set(auth(tB)).set('User-Agent', 'jest-ua-assinatura').send({});
    expect(ass.status).toBe(201);
    expect((await draft(id)).status).toBe('assinado');
    expect(ass.body.aviso_assinatura).toBe(AVISO_ASSINATURA_INTERNA);
    expect(ass.body.assinaturas).toHaveLength(1);
    expect(ass.body.assinaturas[0]).toMatchObject({ vigente: true, council: 'TESTE', registration_number: '0000', uf: 'SC', version_number: 2 });
    const sig = (await db.client.query('SELECT * FROM document_draft_signatures WHERE draft_id=$1', [id])).rows[0];
    expect(sig.signer_user_id).toBe(B.userId);
    expect(sig.registration_id).toBe(regB);
    expect([sig.council, sig.registration_number, sig.uf.trim()]).toEqual(['TESTE', '0000', 'SC']);
    expect(sig.version_id).toBe(rows2[1].id);
    expect(sig.version_sha256).toBe(sha256(buf2));
    expect(sig.user_agent).toBe('jest-ua-assinatura');
    expect(sig.ip).toBeTruthy();
    expect(await nDocs(montese.tenantId)).toBe(0); // nada é publicado antes de publicar

    // B publica
    const pub = await post(tB, `/${id}/publicar`, { expires_at: '2031-01-31' });
    expect(pub.status).toBe(201);
    const d = await draft(id);
    expect(d.status).toBe('publicado');
    expect(d.published_document_id).toBeTruthy();
    const doc = (await db.client.query('SELECT *, to_char(expires_at, \'YYYY-MM-DD\') AS exp FROM documents WHERE id=$1', [d.published_document_id])).rows[0];
    expect(doc).toMatchObject({
      tenant_id: montese.tenantId, category: CAT, title: TITULO, file_name: rows2[1].file_name,
      mime_type: 'application/pdf', size_bytes: buf2.length, uploaded_by_user_id: B.userId, uploaded_by_role: 'socio', exp: '2031-01-31',
    });
    // a publicação usa uma CÓPIA em chave própria (padrão de documents); a versão mantém a chave original
    expect(doc.file_key).not.toBe(rows2[1].file_key);
    expect(doc.file_key).toMatch(new RegExp(`^tenants/${montese.tenantId}/documents/${doc.id}/`));
    expect((await draft(id)).publish_file_key).toBe(doc.file_key);
    expect(r2Fake.putObject.mock.calls.filter(([k]) => k === doc.file_key)).toHaveLength(1);
    expect(r2Fake.putObject.mock.calls.filter(([k]) => k === rows2[1].file_key)).toHaveLength(1); // a da própria versão, nunca reenviada
    expect(r2.has(rows2[1].file_key)).toBe(true);
    expect(r2.has(doc.file_key)).toBe(true);
    expect(sha256(r2.get(doc.file_key)!.body)).toBe(rows2[1].sha256);
    expect(sha256(r2.get(doc.file_key)!.body)).toBe(sha256(r2.get(rows2[1].file_key)!.body));
    expect(r2.get(doc.file_key)!.mime).toBe('application/pdf');
    // visível ao tenant e a mais ninguém (outros tenants, técnico e parceiro leem 0)
    const ver = (ctx: Papel) => comPapel(ctx, async (cl) => (await cl.query('SELECT id FROM documents WHERE id=$1', [doc.id])).rowCount);
    expect(await ver({ role: 'empresa', userId: montese.userId, tenantId: montese.tenantId })).toBe(1);
    expect(await ver({ role: 'empresa', userId: comTecnico.userId, tenantId: comTecnico.tenantId })).toBe(0);
    expect(await ver({ role: 'tecnico', userId: tecnicoUser.userId })).toBe(0);
    expect(await ver({ role: 'parceiro', userId: parceiroUser.userId })).toBe(0);

    // histórico completo e ordenado
    expect((await eventos(id)).map((e: any) => e.type)).toEqual([
      'created', 'version_added', 'submitted', 'returned', 'version_added', 'submitted', 'approved', 'signed', 'published',
    ]);
    const ret = (await eventos(id)).find((e: any) => e.type === 'returned');
    expect(ret.actor_user_id).toBe(B.userId);
    expect(ret.note).toBe(NOTA);

    // detalhe: nomes dos atores via list_socios(), aviso exato e nenhum termo proibido fora do aviso
    const det = await get(tA, `/${id}`);
    expect(det.status).toBe(200);
    expect(det.body.aviso_assinatura).toBe(AVISO_ASSINATURA_INTERNA);
    expect(det.body.eventos.map((e: any) => e.actor_name)).toContain('Socio Fluxo B');
    expect(det.body.acoes_permitidas).toEqual([]);
    expect(semAviso(det.body)).not.toMatch(/assinatura digital|ICP-Brasil/i);

    // listagem com filtros
    const lista = await get(tA, `?tenantId=${montese.tenantId}&status=publicado&category=${CAT}`);
    expect(lista.status).toBe(200);
    expect(lista.body.map((x: any) => x.id)).toContain(id);
    expect((await get(tA, '?status=invalido')).status).toBe(400);

    // simula DocumentsService.remove: apaga o objeto pela file_key do documento e a linha; a versão no fluxo sobrevive
    await r2Fake.deleteObject(doc.file_key);
    await db.client.query('DELETE FROM documents WHERE id=$1', [doc.id]);
    expect(r2.has(doc.file_key)).toBe(false);
    expect(r2.has(rows2[1].file_key)).toBe(true);
    expect((await draft(id)).status).toBe('publicado');
    expect((await get(tA, `/${id}/versoes/${rows2[1].id}/download`)).status).toBe(200);
    expect(r2.get(rows2[1].file_key)!.body.equals(buf2)).toBe(true);

    // download da versão sob RLS (URL temporária); query string não vai para a auditoria
    const dl = await request(app.getHttpServer()).get(`${base}/${id}/versoes/${rows2[1].id}/download?x=segredo`).set(auth(tA));
    expect(dl.status).toBe(200);
    expect(dl.body.url).toBe(`https://r2.fake/${rows2[1].file_key}?assinado=1`);

    // auditoria: ids e nomes apenas
    const aud = await auditorias([A.userId, B.userId], 12);
    const acoes = aud.map((x) => x.action);
    expect(acoes).toEqual(expect.arrayContaining([
      'document_draft.created', 'document_draft.version_added', 'document_draft.submitted', 'document_draft.returned',
      'document_draft.approved', 'document_draft.signed', 'document_draft.published', 'document_draft.downloaded',
    ]));
    const txt = JSON.stringify(aud);
    expect(txt).not.toContain(TITULO);
    expect(txt).not.toContain(NOTA);
    expect(txt).not.toContain('segredo');
    expect(txt).not.toContain('0000');
    for (const x of aud) {
      expect(x.path).not.toContain('?');
      expect(x.resource_type).toBe('document_draft');
      expect(x.resource_id).toBe(id);
    }
  }, 60000);

  it('matriz vazia: 403 em toda ação restrita (MSG fixa) e nada muda (estado, versões, eventos, R2, documents)', async () => {
    const emElab = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const emRev = await semear(montese.tenantId, A.userId, 'em_revisao');
    const aprov = await semear(montese.tenantId, A.userId, 'aprovado');
    const assin = await semear(montese.tenantId, A.userId, 'assinado', { assinarCom: B.userId });
    const putsAntes = r2Fake.putObject.mock.calls.length;
    const docsAntes = await nDocs(montese.tenantId);
    const snapshot = async () => JSON.stringify([
      await Promise.all([emElab, emRev, aprov, assin].map(async (x) => [(await draft(x.id)).status, (await eventos(x.id)).length, (await versoes(x.id)).length, await nSig(x.id)])),
    ]);
    const antes = await snapshot();
    const casos: Array<[string, () => request.Test]> = [
      ['criar', () => post(tE, '', { tenant_id: montese.tenantId, category: CAT, title: TITULO })],
      ['nova versão', () => upload(tE, emElab.id, PDF('x'))],
      ['enviar-revisao', () => post(tE, `/${emElab.id}/enviar-revisao`)],
      ['devolver', () => post(tE, `/${emRev.id}/devolver`, { note: NOTA })],
      ['aprovar', () => post(tE, `/${emRev.id}/aprovar`)],
      ['assinar', () => post(tE, `/${aprov.id}/assinar`)],
      ['publicar', () => post(tE, `/${assin.id}/publicar`, {})],
      ['cancelar', () => post(tE, `/${emElab.id}/cancelar`, { note: NOTA })],
    ];
    for (const [nome, req] of casos) {
      const r = await req();
      expect([nome, r.status, r.body.message]).toEqual([nome, 403, MSG_ACAO_NAO_HABILITADA]);
    }
    expect(await snapshot()).toBe(antes);
    expect(r2Fake.putObject.mock.calls.length).toBe(putsAntes);
    expect(await nDocs(montese.tenantId)).toBe(docsAntes);
    // cada negação por matriz foi auditada (ids e código; sem título/nota; path sem query) sem mudar a resposta
    const aud = (await auditorias([E.userId], 8)).filter((x) => x.action === 'document_draft.denied');
    expect(aud.length).toBe(8);
    for (const x of aud) {
      expect(x.detail).toMatch(/codigo: MATRIZ/);
      expect(x.status_code).toBe(403);
      expect(x.path).not.toContain('?');
      expect(x.resource_type).toBe('document_draft');
    }
    expect(JSON.stringify(aud)).not.toContain(TITULO);
    expect(JSON.stringify(aud)).not.toContain(NOTA);
    // E nem enxerga ações no detalhe
    const det = await get(tE, `/${emRev.id}`);
    expect(det.status).toBe(200);
    expect(det.body.acoes_permitidas).toEqual([]);
  }, 60000);

  it('registro profissional pendente: assinar => 403 e nada muda; e sem estado correto => 409', async () => {
    const aprov = await semear(montese.tenantId, A.userId, 'aprovado');
    const eventosAntes = (await eventos(aprov.id)).length;
    const r = await post(tC, `/${aprov.id}/assinar`);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('Registro profissional não confirmado.');
    expect((await draft(aprov.id)).status).toBe('aprovado');
    expect(await nSig(aprov.id)).toBe(0);
    expect((await eventos(aprov.id)).length).toBe(eventosAntes);
    const det = await get(tC, `/${aprov.id}`);
    expect(det.body.acoes_permitidas).not.toContain('assinar');
    const emRev = await semear(montese.tenantId, A.userId, 'em_revisao');
    expect((await post(tC, `/${emRev.id}/assinar`)).status).toBe(409);
  }, 60000);

  it('sem separação de funções (decisão do proprietário, 2026-11-01): o elaborador devolve (abre correção) e aprova; a trilha registra quem fez', async () => {
    const casos: Array<[string, Awaited<ReturnType<typeof semear>>]> = [
      ['autor da versão atual', await semear(montese.tenantId, B.userId, 'em_revisao')],
      ['autor de versão antiga', await semear(montese.tenantId, A.userId, 'em_revisao', { anteriores: [B.userId] })],
      ['quem enviou à revisão', await semear(montese.tenantId, A.userId, 'em_revisao', { submeteu: B.userId })],
      ['criador do rascunho', await semear(montese.tenantId, A.userId, 'em_revisao', { criador: B.userId })],
    ];
    for (const [nome, d] of casos) {
      const apr = await post(tB, `/${d.id}/aprovar`);
      expect([nome, 'aprovar', apr.status]).toEqual([nome, 'aprovar', 201]);
      expect((await draft(d.id)).status).toBe('aprovado');
      expect((await eventos(d.id)).at(-1).actor_user_id).toBe(B.userId);
    }
    const dev = await semear(montese.tenantId, B.userId, 'em_revisao');
    const r = await post(tB, `/${dev.id}/devolver`, { note: NOTA });
    expect(r.status).toBe(201);
    expect((await draft(dev.id)).status).toBe('em_elaboracao');
    expect(r.body.correcoes).toHaveLength(1);
    const negs = (await auditorias([B.userId], 20)).filter((x) => x.action === 'document_draft.denied');
    expect(negs.some((x) => /codigo: SEPARACAO/.test(x.detail))).toBe(false);
  }, 90000);

  it('a mesma pessoa (não elaboradora) aprova, assina e publica quando a matriz permite', async () => {
    const d = await semear(montese.tenantId, A.userId, 'em_revisao');
    expect((await post(tH, `/${d.id}/aprovar`)).status).toBe(201);
    expect((await post(tH, `/${d.id}/assinar`)).status).toBe(201);
    const pub = await post(tH, `/${d.id}/publicar`, {});
    expect(pub.status).toBe(201);
    expect((await draft(d.id)).status).toBe('publicado');
    expect((await eventos(d.id)).map((e: any) => e.type)).toEqual(['approved', 'signed', 'published']);
  }, 60000);

  it('nova versão após aprovação/assinatura: volta a em_elaboracao, assinatura antiga permanece mas não vale e publicar => 409', async () => {
    const ap = await semear(montese.tenantId, B.userId, 'aprovado');
    const n1 = await upload(tA, ap.id, PDF('nova-1'));
    expect(n1.status).toBe(201);
    expect((await draft(ap.id)).status).toBe('em_elaboracao');
    expect((await post(tB, `/${ap.id}/assinar`)).status).toBe(409);

    const as = await semear(montese.tenantId, B.userId, 'assinado', { assinarCom: B.userId });
    const docsAntes = await nDocs(montese.tenantId);
    const n2 = await upload(tA, as.id, PDF('nova-2'));
    expect(n2.status).toBe(201);
    expect((await draft(as.id)).status).toBe('em_elaboracao');
    expect(await nSig(as.id)).toBe(1); // a linha antiga permanece
    expect(n2.body.assinaturas).toHaveLength(1);
    expect(n2.body.assinaturas[0].vigente).toBe(false);
    expect(n2.body.assinaturas[0].version_id).toBe(as.versionId);
    expect(n2.body.aviso_assinatura).toBe(AVISO_ASSINATURA_INTERNA);
    const pub = await post(tB, `/${as.id}/publicar`, {});
    expect(pub.status).toBe(409);
    expect(await nDocs(montese.tenantId)).toBe(docsAntes);

    // publicado e cancelado são terminais: nova versão => 409
    const canc = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    expect((await post(tA, `/${canc.id}/cancelar`, { note: NOTA })).status).toBe(201);
    expect((await draft(canc.id)).status).toBe('cancelado');
    expect((await eventos(canc.id)).map((e: any) => e.type)).toEqual(['cancelled']);
    expect((await upload(tA, canc.id, PDF('x'))).status).toBe(409);
    expect((await post(tA, `/${canc.id}/cancelar`, { note: NOTA })).status).toBe(409);
  }, 60000);

  it('duas novas versões simultâneas não colidem no número da versão (FOR UPDATE)', async () => {
    const d = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const [r1, r2x] = await Promise.all([upload(tA, d.id, PDF('par-1')), upload(tA, d.id, PDF('par-2'))]);
    expect([r1.status, r2x.status]).toEqual([201, 201]);
    expect((await versoes(d.id)).map((v: any) => v.version_number)).toEqual([1, 2, 3]);
  }, 60000);

  it('tenant de técnico (fora da carteira Montese) e rascunho inexistente => 404; nada é criado', async () => {
    const alheio = await semear(comTecnico.tenantId, A.userId, 'em_elaboracao').catch(() => null);
    const putsAntes = r2Fake.putObject.mock.calls.length;
    const tituloNovo = `Novo-${sufixo}`;
    const c = await post(tA, '', { tenant_id: comTecnico.tenantId, category: CAT, title: tituloNovo });
    expect(c.status).toBe(404);
    expect((await db.client.query('SELECT 1 FROM document_drafts WHERE title=$1', [tituloNovo])).rowCount).toBe(0);
    const inexistente = randomUUID();
    for (const r of [await get(tA, `/${inexistente}`), await post(tB, `/${inexistente}/aprovar`), await upload(tA, inexistente, PDF('x'))]) {
      expect(r.status).toBe(404);
    }
    if (alheio) {
      // rascunho semeado em tenant de técnico existe no banco, mas o sócio não o enxerga
      expect((await get(tA, `/${alheio.id}`)).status).toBe(404);
      expect((await upload(tA, alheio.id, PDF('x'))).status).toBe(404);
      expect((await post(tB, `/${alheio.id}/aprovar`)).status).toBe(404);
      expect((await get(tA, `/${alheio.id}/versoes/${alheio.versionId}/download`)).status).toBe(404);
      expect((await get(tA, `?tenantId=${comTecnico.tenantId}`)).body).toEqual([]);
      expect((await get(tA, '')).body.map((x: any) => x.id)).not.toContain(alheio.id);
      expect((await draft(alheio.id)).status).toBe('em_elaboracao');
    }
    expect(r2Fake.putObject.mock.calls.length).toBe(putsAntes);
  }, 60000);

  it('download sob RLS: versão de outro rascunho => 404; versão do próprio => URL temporária', async () => {
    const d1 = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const d2 = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    expect((await get(tA, `/${d1.id}/versoes/${d2.versionId}/download`)).status).toBe(404);
    expect((await get(tA, `/${d1.id}/versoes/${randomUUID()}/download`)).status).toBe(404);
    const ok = await get(tA, `/${d1.id}/versoes/${d1.versionId}/download`);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toBe(`https://r2.fake/${d1.fileKey}?assinado=1`);
  }, 60000);

  it('empresa, técnico, parceiro e admin => 403 em todas as rotas do sócio; sócio sem permissão RBAC => 403; sem token => 401', async () => {
    const d = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const rotas: Array<[string, string, object?]> = [
      ['get', ''], ['get', `/${d.id}`], ['post', '', { tenant_id: montese.tenantId, category: CAT, title: 'x' }],
      ['post', `/${d.id}/enviar-revisao`], ['post', `/${d.id}/devolver`, { note: 'x' }], ['post', `/${d.id}/aprovar`],
      ['post', `/${d.id}/assinar`], ['post', `/${d.id}/publicar`], ['post', `/${d.id}/cancelar`, { note: 'x' }],
      ['get', `/${d.id}/versoes/${d.versionId}/download`],
    ];
    const antes = JSON.stringify([await draft(d.id), await eventos(d.id), await versoes(d.id)]);
    for (const [nome, tk] of [['empresa', tEmp], ['tecnico', tTec], ['parceiro', tPar], ['admin', tAdmin], ['socio sem permissão', tF]] as const) {
      for (const [m, path, body] of rotas) {
        const r = m === 'get' ? await get(tk, path) : await post(tk, path, body ?? {});
        expect([nome, m, path, r.status]).toEqual([nome, m, path, 403]);
      }
      const up = await upload(tk, d.id, PDF('x'));
      expect([nome, 'upload', up.status]).toEqual([nome, 'upload', 403]);
    }
    expect((await request(app.getHttpServer()).get(base)).status).toBe(401);
    expect(JSON.stringify([await draft(d.id), await eventos(d.id), await versoes(d.id)])).toBe(antes);
  }, 120000);

  it('arquivo: tipo inválido, conteúdo que não confere, ausente => 400; acima de 10 MB => 413; nada no R2 nem em versões', async () => {
    const d = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const puts = r2Fake.putObject.mock.calls.length;
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(tA, d.id, html, { mime: 'text/html', nome: 'a.html' })).status).toBe(400);
    expect((await upload(tA, d.id, html, { mime: 'application/pdf' })).status).toBe(400); // conteúdo não é PDF
    expect((await upload(tA, d.id, Buffer.from('PK\x03\x04 nao-e-docx'), { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', nome: 'a.docx' })).status).toBe(400);
    const sem = await request(app.getHttpServer()).post(`${base}/${d.id}/versoes`).set(auth(tA)).field('note', 'x');
    expect(sem.status).toBe(400);
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(tA, d.id, grande)).status).toBe(413);
    expect(r2Fake.putObject.mock.calls.length).toBe(puts);
    expect((await versoes(d.id)).length).toBe(1);
    // nota longa demais
    expect((await upload(tA, d.id, PDF('n'), { nota: 'n'.repeat(1001) })).status).toBe(400);
    expect((await versoes(d.id)).length).toBe(1);
  }, 60000);

  it('corpo com tenant_id/created_by/status/actor nas transições => 400 e nada muda; data de vencimento inválida => 400', async () => {
    const emElab = await semear(montese.tenantId, A.userId, 'em_elaboracao');
    const emRev = await semear(montese.tenantId, A.userId, 'em_revisao');
    const aprov = await semear(montese.tenantId, A.userId, 'aprovado');
    const assin = await semear(montese.tenantId, A.userId, 'assinado', { assinarCom: B.userId });
    const intrusos = [{ tenant_id: comTecnico.tenantId }, { created_by: B.userId }, { status: 'publicado' }, { actor: B.userId }, { actor_user_id: B.userId }];
    const estados = async () => JSON.stringify(await Promise.all([emElab, emRev, aprov, assin].map(async (x) => [await draft(x.id), await eventos(x.id)])));
    const antes = await estados();
    for (const extra of intrusos) {
      for (const [tk, path, body] of [
        [tA, `/${emElab.id}/enviar-revisao`, {}], [tB, `/${emRev.id}/devolver`, { note: 'n' }], [tB, `/${emRev.id}/aprovar`, {}],
        [tB, `/${aprov.id}/assinar`, {}], [tB, `/${assin.id}/publicar`, {}], [tA, `/${emElab.id}/cancelar`, { note: 'n' }],
      ] as Array<[string, string, object]>) {
        const r = await post(tk, path, { ...body, ...extra });
        expect([path, Object.keys(extra)[0], r.status]).toEqual([path, Object.keys(extra)[0], 400]);
      }
      if (!('tenant_id' in extra)) {
        const c = await post(tA, '', { tenant_id: montese.tenantId, category: CAT, title: 'x', ...extra });
        expect(c.status).toBe(400);
      }
    }
    for (const bad of ['2026-02-30', '31/01/2031', 'amanhã', 20310131]) {
      expect((await post(tB, `/${assin.id}/publicar`, { expires_at: bad })).status).toBe(400);
    }
    expect(await estados()).toBe(antes);
    // categoria fora do domínio de documents
    expect((await post(tA, '', { tenant_id: montese.tenantId, category: 'xyz', title: 'x' })).status).toBe(400);
  }, 120000);

  it('publicar sem vencimento é aceito (vencimento é opcional; nenhuma categoria é presumida obrigatória) e a mensagem de erro não usa termos proibidos', async () => {
    const assin = await semear(montese.tenantId, A.userId, 'assinado', { assinarCom: B.userId });
    const ok = await post(tB, `/${assin.id}/publicar`, {});
    expect(ok.status).toBe(201);
    const doc = (await db.client.query('SELECT expires_at FROM documents WHERE id=$1', [(await draft(assin.id)).published_document_id])).rows[0];
    expect(doc.expires_at).toBeNull();
    const de = await post(tB, `/${assin.id}/publicar`, {});
    expect(de.status).toBe(409);
    expect(semAviso(de.body)).not.toMatch(/assinatura digital|ICP-Brasil/i);
    expect((await draft(assin.id)).status).toBe('publicado');
    expect(await nDocs(montese.tenantId)).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('cancelar: exige documents.cancel + ação de matriz do estágio + nota; histórico preservado; publicado => 409', async () => {
    const ass = await semear(montese.tenantId, B.userId, 'assinado');
    const apr = await semear(montese.tenantId, B.userId, 'aprovado');
    const historico = async (id: string) => JSON.stringify([await eventos(id), (await versoes(id)).map((v: any) => v.id), await nSig(id)]);
    const antes = JSON.stringify([await draft(ass.id), await historico(ass.id), await draft(apr.id), await historico(apr.id)]);
    // sem documents.cancel (C tem elaborar+assinar na matriz) => 403 da camada RBAC, nada muda
    const semPerm = await post(tC, `/${ass.id}/cancelar`, { note: NOTA });
    expect(semPerm.status).toBe(403);
    expect(semPerm.body.code).toBe('PERMISSION_DENIED');
    // com documents.cancel, mas sem a ação de matriz do estágio (A só elabora) => 403 MSG_ACAO_NAO_HABILITADA
    for (const alvo of [ass, apr]) {
      const r = await post(tA, `/${alvo.id}/cancelar`, { note: NOTA });
      expect([r.status, r.body.message]).toEqual([403, MSG_ACAO_NAO_HABILITADA]);
    }
    expect(JSON.stringify([await draft(ass.id), await historico(ass.id), await draft(apr.id), await historico(apr.id)])).toBe(antes);
    expect((await get(tA, `/${ass.id}`)).body.acoes_permitidas).not.toContain('cancelar');
    // justificativa vazia/ausente => 400
    expect((await get(tH, `/${ass.id}`)).body.acoes_permitidas).toContain('cancelar');
    for (const body of [{}, { note: '   ' }]) expect((await post(tH, `/${ass.id}/cancelar`, body)).status).toBe(400);
    expect((await draft(ass.id)).status).toBe('assinado');
    // H (documents.cancel + elaborar + assinar) cancela o assinado; o histórico permanece e ganha o evento
    const ok = await post(tH, `/${ass.id}/cancelar`, { note: NOTA });
    expect(ok.status).toBe(201);
    expect((await draft(ass.id)).status).toBe('cancelado');
    const ev = await eventos(ass.id);
    expect(ev.at(-1)).toMatchObject({ type: 'cancelled', actor_user_id: H.userId });
    expect(ev.at(-1).note).toContain(NOTA);
    expect(ev.at(-1).note).toContain('origem: assinado');
    expect(ev.slice(0, -1).map((e: any) => e.type)).toEqual(JSON.parse(antes)[1] ? JSON.parse(JSON.parse(antes)[1])[0].map((e: any) => e.type) : []);
    expect((await versoes(ass.id)).length).toBe(1);
    expect(await nSig(ass.id)).toBe(1);
    // publicado é terminal
    const pubd = await semear(montese.tenantId, B.userId, 'assinado');
    expect((await post(tB, `/${pubd.id}/publicar`, {})).status).toBe(201);
    expect((await post(tH, `/${pubd.id}/cancelar`, { note: NOTA })).status).toBe(409);
    expect((await draft(pubd.id)).status).toBe('publicado');
    // não existe rota de exclusão
    expect((await request(app.getHttpServer()).delete(`${base}/${pubd.id}`).set(auth(tH))).status).toBe(404);
  }, 60000);

  it('J: conselho/número/UF só com documents.view_registration (JSON inteiro); o snapshot no banco é o mesmo nos dois casos', async () => {
    const d = await semear(montese.tenantId, A.userId, 'aprovado');
    expect((await post(tG, `/${d.id}/assinar`)).status).toBe(201);
    const snap = (await db.client.query('SELECT council, registration_number, uf FROM document_draft_signatures WHERE draft_id=$1', [d.id])).rows[0];
    expect([snap.council, snap.registration_number, snap.uf.trim()]).toEqual(['TESTE', '0000', 'SC']);
    const sem = await get(tA, `/${d.id}`); // A não tem documents.view_registration
    const com = await get(tG, `/${d.id}`);
    expect(sem.status).toBe(200);
    expect(JSON.stringify(sem.body)).not.toMatch(/TESTE|"registration_number"|"council"|"uf"|"0000"/);
    expect(sem.body.assinaturas[0]).toMatchObject({ registro_confirmado: true, signer_name: 'Socio Fluxo G', vigente: true });
    expect(com.body.assinaturas[0]).toMatchObject({ council: 'TESTE', registration_number: '0000', uf: 'SC', registro_confirmado: true });
    // a resposta da própria assinatura e a listagem também respeitam a regra
    const lista = await get(tA, `?tenantId=${montese.tenantId}`);
    expect(JSON.stringify(lista.body)).not.toMatch(/TESTE|"registration_number"|"council"/);
    const snap2 = (await db.client.query('SELECT council, registration_number, uf FROM document_draft_signatures WHERE draft_id=$1', [d.id])).rows[0];
    expect(snap2).toEqual(snap);
  }, 60000);

  it('registro revogado não assina (403), a assinatura anterior permanece e continua vigente; revogar: só confirmado, 409 ao repetir, 404 inexistente, só admin', async () => {
    const d1 = await semear(montese.tenantId, A.userId, 'aprovado');
    const d2 = await semear(montese.tenantId, A.userId, 'aprovado');
    expect((await post(tG, `/${d1.id}/assinar`)).status).toBe(201);
    const rota = `/atuacao/admin/documentos/registros/${regG}/revogar`;
    const adminPost = (t: string, path: string) => request(app.getHttpServer()).post(path).set(auth(t)).send({});
    for (const tk of [tG, tA, tEmp, tTec, tPar]) expect((await adminPost(tk, rota)).status).toBe(403);
    expect((await adminPost(tAdmin, `/atuacao/admin/documentos/registros/${randomUUID()}/revogar`)).status).toBe(404);
    const rev = await adminPost(tAdmin, rota);
    expect(rev.status).toBe(201);
    expect(rev.body.status).toBe('revogado');
    expect((await adminPost(tAdmin, rota)).status).toBe(409);
    const row = (await db.client.query('SELECT status, revoked_by, confirmed_by FROM professional_registrations WHERE id=$1', [regG])).rows[0];
    expect(row).toMatchObject({ status: 'revogado', revoked_by: admin.userId });
    // revogado não assina
    const neg = await post(tG, `/${d2.id}/assinar`);
    expect(neg.status).toBe(403);
    expect(neg.body.message).toBe('Registro profissional não confirmado.');
    expect((await draft(d2.id)).status).toBe('aprovado');
    expect(await nSig(d2.id)).toBe(0);
    // a assinatura anterior permanece e vale (versão não mudou)
    const det = await get(tG, `/${d1.id}`);
    expect(det.body.status).toBe('assinado');
    expect(det.body.assinaturas).toHaveLength(1);
    expect(det.body.assinaturas[0]).toMatchObject({ vigente: true, council: 'TESTE', registration_number: '0000' });
    expect(await nSig(d1.id)).toBe(1);
    // auditoria da revogação: só ids
    const aud = (await db.client.query("SELECT detail, resource_id FROM audit_log WHERE actor_user_id=$1 AND action='professional_registration.revoked'", [admin.userId])).rows;
    expect(aud.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(aud)).not.toContain('0000');
    expect(aud[0].resource_id).toBe(regG);
  }, 60000);

  it('integridade: objeto da versão adulterado entre assinar e publicar => 409; nada em documents, draft continua assinado, nenhuma cópia órfã', async () => {
    const d = await semear(montese.tenantId, A.userId, 'aprovado');
    expect((await post(tB, `/${d.id}/assinar`)).status).toBe(201);
    expect((await draft(d.id)).status).toBe('assinado');
    r2.set(d.fileKey, { body: Buffer.from('%PDF-1.4 conteudo adulterado'), mime: 'application/pdf' });
    const chaves = [...r2.keys()].sort();
    const puts = r2Fake.putObject.mock.calls.length;
    const docs = await nDocs(montese.tenantId);
    const r = await post(tB, `/${d.id}/publicar`, {});
    expect(r.status).toBe(409);
    expect((await draft(d.id)).status).toBe('assinado');
    expect((await draft(d.id)).publish_file_key).toBeNull();
    expect(await nDocs(montese.tenantId)).toBe(docs);
    expect([...r2.keys()].sort()).toEqual(chaves);
    expect(r2Fake.putObject.mock.calls.length).toBe(puts);
  }, 60000);

  // O frontend envia POST SEM corpo e SEM Content-Type nas ações sem nota.
  const semCorpo = (t: string, path: string, json = false) => {
    const r = request(app.getHttpServer()).post(`${base}${path}`).set(auth(t));
    return json ? r.set('Content-Type', 'application/json') : r;
  };

  it('POST sem corpo (sem Content-Type, e com application/json vazio) chega à regra de negócio: enviar-revisao, aprovar, assinar, publicar', async () => {
    for (const json of [false, true]) {
      const elab = await semear(montese.tenantId, A.userId, 'em_elaboracao');
      const rev = await semear(montese.tenantId, A.userId, 'em_revisao');
      const apr = await semear(montese.tenantId, A.userId, 'aprovado');
      const ass = await semear(montese.tenantId, A.userId, 'assinado');
      // caminho feliz
      const r1 = (await semCorpo(tA, `/${elab.id}/enviar-revisao`, json)).status;
      expect([json, 'enviar-revisao', r1]).toEqual([json, 'enviar-revisao', 201]);
      expect((await draft(elab.id)).status).toBe('em_revisao');
      expect((await semCorpo(tH, `/${rev.id}/aprovar`, json)).status).toBe(201);
      expect((await draft(rev.id)).status).toBe('aprovado');
      expect((await semCorpo(tH, `/${apr.id}/assinar`, json)).status).toBe(201);
      expect((await draft(apr.id)).status).toBe('assinado');
      expect((await semCorpo(tH, `/${ass.id}/publicar`, json)).status).toBe(201);
      expect((await draft(ass.id)).status).toBe('publicado');
      // caminho bloqueado: a mesma mensagem do servidor (matriz), nunca 400 de validação por corpo ausente
      const bloq = await semear(montese.tenantId, A.userId, 'em_elaboracao');
      const b = await semCorpo(tE, `/${bloq.id}/enviar-revisao`, json);
      expect([b.status, b.body.message]).toEqual([403, MSG_ACAO_NAO_HABILITADA]);
      const b2 = await semCorpo(tE, `/${bloq.id}/aprovar`, json); // estado errado => 409 do servidor
      expect(b2.status).toBe(409);
    }
  }, 120000);

  it('devolver e cancelar sem corpo => 400 pela NOTA obrigatória (validação, não erro de parse); campo desconhecido continua 400', async () => {
    const rev = await semear(montese.tenantId, A.userId, 'em_revisao');
    const antes = JSON.stringify(await draft(rev.id));
    for (const json of [false, true]) {
      for (const rota of ['devolver', 'cancelar']) {
        const r = await semCorpo(tH, `/${rev.id}/${rota}`, json);
        expect([rota, json, r.status]).toEqual([rota, json, 400]);
        expect(JSON.stringify(r.body.message)).toMatch(/note/);
      }
    }
    expect(JSON.stringify(await draft(rev.id))).toBe(antes);
    // campo desconhecido segue rejeitado (forbidNonWhitelisted), em todas as ações sem nota
    for (const rota of ['enviar-revisao', 'aprovar', 'assinar', 'publicar']) {
      const r = await post(tH, `/${rev.id}/${rota}`, { campo_desconhecido: 1 });
      expect([rota, r.status]).toEqual([rota, 400]);
    }
    expect(JSON.stringify(await draft(rev.id))).toBe(antes);
  }, 60000);

});

// ---------------------------------------------------------------------------------------------
// Fase 5A, Task 4: API do admin (matriz por tipo de documento e registros profissionais), HTTP.
// A matriz nasce vazia; o admin NÃO ganha rotas do fluxo. NENHUM dado profissional real:
// conselho 'TESTE', número '0000'.
// ---------------------------------------------------------------------------------------------
describe('atuacao-documentos — API admin: matriz e registros profissionais (HTTP)', () => {
  const CAT = 'ltcat';
  const RBAC = ['documents.read', 'documents.create_draft', 'documents.review', 'documents.approve', 'documents.sign', 'documents.publish'];
  const adm = '/atuacao/admin/documentos';
  let app: INestApplication;
  let db: TestDb;
  let A: TestUserFixture, B: TestUserFixture, C: TestUserFixture, D: TestUserFixture, F: TestUserFixture, admin: TestUserFixture, tecnicoUser: TestUserFixture, parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let comTecnico: { tenantId: string; userId: string };
  let tA: string, tB: string, tD: string, tF: string, tAdmin: string, tTec: string, tPar: string, tEmp: string;
  const r2 = new Map<string, { body: Buffer; mime: string }>();
  const r2Fake = {
    putObject: jest.fn(async (key: string, body: Buffer, mime: string) => { r2.set(key, { body, mime }); }),
    deleteObject: jest.fn(async (key: string) => { r2.delete(key); }),
    getObject: jest.fn(async (key: string) => r2.get(key)!.body),
    getPresignedDownloadUrl: jest.fn(async (key: string) => `https://r2.fake/${key}?assinado=1`),
  };
  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const aget = (t: string, path: string) => request(app.getHttpServer()).get(`${adm}${path}`).set(auth(t));
  const aput = (t: string, path: string, body: object) => request(app.getHttpServer()).put(`${adm}${path}`).set(auth(t)).send(body);
  const apost = (t: string, path: string, body: object = {}) => request(app.getHttpServer()).post(`${adm}${path}`).set(auth(t)).send(body);
  const putMatriz = (t: string, userId: string, acoes: unknown, cat = CAT) => aput(t, `/matriz/${cat}/usuarios/${userId}`, { acoes });
  const doBanco = async (userId: string, cat = CAT) =>
    (await db.client.query('SELECT action, granted_by FROM document_type_permissions WHERE category=$1 AND user_id=$2 ORDER BY action', [cat, userId])).rows;
  const regsBanco = async (userId: string) =>
    (await db.client.query('SELECT * FROM professional_registrations WHERE user_id=$1 ORDER BY created_at, id', [userId])).rows;
  const novoReg = (userId: string, numero = '0000') => ({ user_id: userId, council: 'TESTE', registration_number: numero, uf: 'SC' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue(r2Fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    A = await db.createUserWithRole('socio', 'Socio Adm A');
    B = await db.createUserWithRole('socio', 'Socio Adm B');
    C = await db.createUserWithRole('socio', 'Socio Adm C');
    D = await db.createUserWithRole('socio', 'Socio Adm D');
    F = await db.createUserWithRole('socio', 'Socio Adm F');
    admin = await db.createUserWithRole('admin', 'Admin Adm');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Adm');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Adm');
    montese = await db.createTenantWithUser('Cliente Montese Adm');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Adm');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [comTecnico.tenantId, tec.rows[0].id]);
    const par = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id", [parceiroUser.userId]);
    const comParceiro = await db.createTenantWithUser('Cliente Parceiro Adm');
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [comParceiro.tenantId, par.rows[0].id]);
    for (const u of [A, B, C, D, F]) for (const p of RBAC) await db.grantSocioPermission(u.userId, p);
    [tA, tB, tD, tF, tAdmin, tTec, tPar, tEmp] = await Promise.all([A, B, D, F, admin, tecnicoUser, parceiroUser, montese].map(login));
  }, 60000);

  afterAll(async () => {
    const us = [A.userId, B.userId, C.userId, D.userId, F.userId, admin.userId];
    await db.client.query('DELETE FROM document_drafts WHERE tenant_id = ANY($1)', [[montese.tenantId, comTecnico.tenantId]]);
    await db.client.query("DELETE FROM documents WHERE tenant_id = ANY($1) AND uploaded_by_role = 'socio'", [[montese.tenantId, comTecnico.tenantId]]);
    await db.client.query('DELETE FROM document_type_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM professional_registrations WHERE user_id = ANY($1) OR created_by = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('PUT substitui o conjunto do par, é idempotente e o banco bate exatamente; vazio remove tudo; granted_by = admin do JWT', async () => {
    const r1 = await putMatriz(tAdmin, A.userId, ['assinar', 'elaborar']);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ category: CAT, user_id: A.userId, acoes: ['elaborar', 'assinar'] });
    expect(await doBanco(A.userId)).toEqual([
      { action: 'assinar', granted_by: admin.userId }, { action: 'elaborar', granted_by: admin.userId },
    ]);
    const r2x = await putMatriz(tAdmin, A.userId, ['elaborar', 'assinar']); // idempotente
    expect(r2x.status).toBe(200);
    expect((await doBanco(A.userId)).map((x: any) => x.action)).toEqual(['assinar', 'elaborar']);
    // substitui (não acumula) e não toca em outro usuário nem em outra categoria
    await putMatriz(tAdmin, B.userId, ['revisar']);
    await putMatriz(tAdmin, A.userId, ['revisar'], 'pgr');
    expect((await putMatriz(tAdmin, A.userId, ['publicar'])).status).toBe(200);
    expect((await doBanco(A.userId)).map((x: any) => x.action)).toEqual(['publicar']);
    expect((await doBanco(B.userId)).map((x: any) => x.action)).toEqual(['revisar']);
    expect((await doBanco(A.userId, 'pgr')).map((x: any) => x.action)).toEqual(['revisar']);
    // vazio remove tudo do par
    expect((await putMatriz(tAdmin, A.userId, [])).status).toBe(200);
    expect(await doBanco(A.userId)).toEqual([]);
    expect((await doBanco(A.userId, 'pgr')).length).toBe(1);
    await putMatriz(tAdmin, A.userId, [], 'pgr');
    await putMatriz(tAdmin, B.userId, []);
  });

  it('PUTs concorrentes do mesmo par terminam em um conjunto íntegro (um dos dois), sem erro', async () => {
    const conjuntos = [['elaborar', 'revisar'], ['aprovar', 'assinar', 'publicar']];
    const rs = await Promise.all([0, 1, 2, 3].map((i) => putMatriz(tAdmin, A.userId, conjuntos[i % 2])));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const final = (await doBanco(A.userId)).map((x: any) => x.action);
    expect([[...conjuntos[0]].sort(), [...conjuntos[1]].sort()]).toContainEqual(final);
    await putMatriz(tAdmin, A.userId, []);
  });

  it('validação: não-sócio/inexistente => 400; categoria inválida => 400; ações repetidas, fora da lista, > 5, tipo errado, extras => 400; nada muda', async () => {
    await putMatriz(tAdmin, B.userId, ['revisar']);
    const antes = await doBanco(B.userId);
    for (const alvo of [tecnicoUser.userId, parceiroUser.userId, admin.userId, montese.userId]) {
      const r = await putMatriz(tAdmin, alvo, ['elaborar']);
      expect([alvo, r.status, r.body.message]).toEqual([alvo, 400, 'Responsável inválido']);
    }
    expect((await putMatriz(tAdmin, randomUUID(), ['elaborar'])).status).toBe(400);
    expect((await putMatriz(tAdmin, 'nao-e-uuid', ['elaborar'])).status).toBe(400);
    expect((await putMatriz(tAdmin, B.userId, ['elaborar'], 'xyz')).status).toBe(400);
    for (const acoes of [['elaborar', 'elaborar'], ['excluir'], ['elaborar', 'ASSINAR'], ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar', 'elaborar'], 'elaborar', null, undefined, [null], [1]]) {
      const r = await putMatriz(tAdmin, B.userId, acoes);
      expect([JSON.stringify(acoes), r.status]).toEqual([JSON.stringify(acoes), 400]);
    }
    expect((await aput(tAdmin, `/matriz/${CAT}/usuarios/${B.userId}`, { acoes: ['elaborar'], granted_by: A.userId })).status).toBe(400);
    expect((await aget(tAdmin, '/matriz?category=xyz')).status).toBe(400);
    expect(await doBanco(B.userId)).toEqual(antes);
    expect((await doBanco(tecnicoUser.userId)).length).toBe(0);
    await putMatriz(tAdmin, B.userId, []);
  });

  it('GET matriz reflete o banco (só quem tem ao menos uma ação, com nome) e respeita ?category=', async () => {
    await putMatriz(tAdmin, A.userId, ['elaborar', 'assinar']);
    await putMatriz(tAdmin, B.userId, ['revisar'], 'pgr');
    const meus = (rows: any[]) => rows.filter((x) => [A.userId, B.userId].includes(x.user_id));
    const ltcat = await aget(tAdmin, `/matriz?category=${CAT}`);
    expect(ltcat.status).toBe(200);
    expect(meus(ltcat.body)).toEqual([{ category: CAT, user_id: A.userId, nome: 'Socio Adm A', acoes: ['elaborar', 'assinar'] }]);
    const todas = meus((await aget(tAdmin, '/matriz')).body);
    expect(todas).toHaveLength(2);
    expect(todas).toContainEqual({ category: 'pgr', user_id: B.userId, nome: 'Socio Adm B', acoes: ['revisar'] });
    // B não tem ação em ltcat => não aparece
    expect(meus(ltcat.body).some((x) => x.user_id === B.userId)).toBe(false);
    const doBancoTudo = (await db.client.query(
      'SELECT category, user_id, array_agg(action ORDER BY action) AS a FROM document_type_permissions WHERE user_id = ANY($1) GROUP BY 1,2', [[A.userId, B.userId]])).rows;
    expect(doBancoTudo.length).toBe(todas.length);
    await putMatriz(tAdmin, A.userId, []);
    await putMatriz(tAdmin, B.userId, [], 'pgr');
    expect(meus((await aget(tAdmin, '/matriz')).body)).toEqual([]);
  });

  it('registro nasce pendente (resposta inclui o número); validação do corpo; duplicata => 409; não-sócio => 400', async () => {
    const c = await apost(tAdmin, '/registros', novoReg(A.userId));
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ user_id: A.userId, nome: 'Socio Adm A', council: 'TESTE', registration_number: '0000', uf: 'SC', status: 'pendente', confirmed_at: null });
    const [linha] = await regsBanco(A.userId);
    expect(linha).toMatchObject({ id: c.body.id, status: 'pendente', confirmed_by: null, confirmed_at: null, created_by: admin.userId });
    expect((await apost(tAdmin, '/registros', novoReg(A.userId))).status).toBe(409);
    expect((await regsBanco(A.userId)).length).toBe(1);
    expect((await apost(tAdmin, '/registros', novoReg(tecnicoUser.userId))).status).toBe(400);
    const ruins = [
      { ...novoReg(A.userId, '0001'), uf: 'sc' }, { ...novoReg(A.userId, '0001'), uf: 'SCC' }, { ...novoReg(A.userId, '0001'), council: 'T' },
      { ...novoReg(A.userId, '0001'), council: 'T'.repeat(21) }, { ...novoReg(A.userId, ''), registration_number: '' },
      { ...novoReg(A.userId, '0'.repeat(31)) }, { ...novoReg(A.userId, '0001'), council: null }, { ...novoReg(A.userId, '0001'), registration_number: null },
      { ...novoReg(A.userId, '0001'), status: 'confirmado' }, { ...novoReg(A.userId, '0001'), created_by: B.userId },
      { ...novoReg(A.userId, '0001'), user_id: 'x' }, { ...novoReg(A.userId, '   ') },
    ];
    for (const b of ruins) expect([JSON.stringify(b), (await apost(tAdmin, '/registros', b)).status]).toEqual([JSON.stringify(b), 400]);
    expect((await regsBanco(A.userId)).length).toBe(1);
    // trim aplicado
    const t = await apost(tAdmin, '/registros', { ...novoReg(B.userId), council: '  TESTE  ', registration_number: ' 0000 ' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ council: 'TESTE', registration_number: '0000' });
  });

  it('GET registros lista com número e filtra por userId; confirmar: pendente->confirmado (confirmed_by = admin), de novo 409, inexistente 404', async () => {
    const todos = (await aget(tAdmin, '/registros')).body.filter((x: any) => [A.userId, B.userId].includes(x.user_id));
    expect(todos.map((x: any) => x.user_id).sort()).toEqual([A.userId, B.userId].sort());
    const soA = await aget(tAdmin, `/registros?userId=${A.userId}`);
    expect(soA.body).toHaveLength(1);
    expect(Object.keys(soA.body[0]).sort()).toEqual(['confirmed_at', 'council', 'id', 'nome', 'registration_number', 'revoked_at', 'status', 'uf', 'user_id']);
    expect((await aget(tAdmin, '/registros?userId=xx')).status).toBe(400);
    const id = soA.body[0].id as string;
    const c1 = await apost(tAdmin, `/registros/${id}/confirmar`);
    expect(c1.status).toBe(201);
    expect(c1.body.status).toBe('confirmado');
    const [linha] = await regsBanco(A.userId);
    expect(linha).toMatchObject({ status: 'confirmado', confirmed_by: admin.userId });
    expect(linha.confirmed_at).not.toBeNull();
    expect((await apost(tAdmin, `/registros/${id}/confirmar`)).status).toBe(409);
    expect((await apost(tAdmin, `/registros/${randomUUID()}/confirmar`)).status).toBe(404);
    expect((await apost(tAdmin, '/registros/nao-uuid/confirmar')).status).toBe(400);
    // não existe rota de edição/remoção de registro
    for (const m of ['put', 'patch', 'delete'] as const) {
      const r = await (request(app.getHttpServer()) as any)[m](`${adm}/registros/${id}`).set(auth(tAdmin)).send({ status: 'pendente' });
      expect([m, r.status]).toEqual([m, 404]);
    }
    expect((await apost(tAdmin, `/registros/${id}`, {})).status).toBe(404);
    expect((await regsBanco(A.userId))[0]).toMatchObject({ status: 'confirmado', registration_number: '0000' });
    // trigger: SQL direto em registro confirmado falha
    expect((await tentaSu(db.client, "UPDATE professional_registrations SET registration_number='9999' WHERE id=$1", [id])).erro).not.toBeNull();
  });

  it('fim a fim: matriz + registro pendente => assinar 403; após confirmar => assinar 201 (admin não participa do fluxo)', async () => {
    const regs = await regsBanco(B.userId);
    expect(regs.map((r: any) => r.status)).toEqual(['pendente']);
    // matriz do par pela API do admin
    expect((await putMatriz(tAdmin, B.userId, ['assinar'], 'pgr')).status).toBe(200);
    // rascunho aprovado, escrito por A
    const id = (await db.client.query(
      `INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1,'pgr',$2,$3) RETURNING id`,
      [montese.tenantId, `Rascunho adm ${randomUUID().slice(0, 8)}`, A.userId])).rows[0].id as string;
    const corpo = Buffer.from('%PDF-1.4\n% adm-e2e\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const fileKey = `documents-fluxo/${montese.tenantId}/${id}/1-${randomUUID()}`;
    r2.set(fileKey, { body: corpo, mime: 'application/pdf' });
    const v = (await db.client.query(
      `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
       VALUES ($1,$2,1,$3,'a.pdf','application/pdf',$4,$5,$6) RETURNING id`,
      [id, montese.tenantId, fileKey, corpo.length, createHash('sha256').update(corpo).digest('hex'), A.userId])).rows[0].id;
    await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [id, v]);
    for (const st of ['em_revisao', 'aprovado']) {
      if (st === 'aprovado') {
        await db.client.query("INSERT INTO document_draft_events (draft_id, tenant_id, version_id, actor_user_id, type) VALUES ($1,$2,$3,$4,'approved')", [id, montese.tenantId, v, A.userId]);
      }
      await db.client.query('UPDATE document_drafts SET status=$2 WHERE id=$1', [id, st]);
    }

    const fluxo = (t: string) => request(app.getHttpServer()).post(`/atuacao/documentos/${id}/assinar`).set(auth(t)).send({});
    const pend = await fluxo(tB);
    expect(pend.status).toBe(403);
    expect((await db.client.query('SELECT status FROM document_drafts WHERE id=$1', [id])).rows[0].status).toBe('aprovado');
    // o admin confirma o registro de B
    expect((await apost(tAdmin, `/registros/${regs[0].id}/confirmar`)).status).toBe(201);
    // o admin não consegue assinar nem agir no fluxo
    expect((await fluxo(tAdmin)).status).toBe(403);
    const ok = await fluxo(tB);
    expect(ok.status).toBe(201);
    expect((await db.client.query('SELECT status FROM document_drafts WHERE id=$1', [id])).rows[0].status).toBe('assinado');
    await putMatriz(tAdmin, B.userId, [], 'pgr');
  }, 60000);

  it('empresa, técnico, parceiro e sócio => 403 em todas as rotas admin; sem token => 401; nada muda', async () => {
    const regId = (await regsBanco(A.userId))[0].id as string;
    const antes = JSON.stringify([await doBanco(A.userId), await regsBanco(A.userId), await regsBanco(B.userId)]);
    const rotas: Array<[string, string, object?]> = [
      ['get', '/matriz'], ['get', `/matriz?category=${CAT}`], ['put', `/matriz/${CAT}/usuarios/${A.userId}`, { acoes: ['elaborar'] }],
      ['get', '/registros'], ['post', '/registros', novoReg(A.userId, '0002')], ['post', `/registros/${regId}/confirmar`],
    ];
    for (const [nome, tk] of [['empresa', tEmp], ['tecnico', tTec], ['parceiro', tPar], ['socio', tA]] as const) {
      for (const [m, path, body] of rotas) {
        const r = await (request(app.getHttpServer()) as any)[m](`${adm}${path}`).set(auth(tk)).send(body ?? {});
        expect([nome, m, path, r.status]).toEqual([nome, m, path, 403]);
      }
    }
    for (const [m, path, body] of rotas) {
      expect([m, path, (await (request(app.getHttpServer()) as any)[m](`${adm}${path}`).send(body ?? {})).status]).toEqual([m, path, 401]);
    }
    expect(JSON.stringify([await doBanco(A.userId), await regsBanco(A.userId), await regsBanco(B.userId)])).toBe(antes);
  }, 60000);

  it('admin => 403 em todas as rotas do fluxo do sócio (não elabora/revisa/aprova/assina/publica)', async () => {
    const id = randomUUID();
    const fluxo = '/atuacao/documentos';
    const rotas: Array<[string, string, object?]> = [
      ['get', ''], ['get', `/${id}`], ['post', '', { tenant_id: montese.tenantId, category: CAT, title: 'x' }],
      ['post', `/${id}/versoes`], ['post', `/${id}/enviar-revisao`], ['post', `/${id}/devolver`, { note: 'x' }], ['post', `/${id}/aprovar`],
      ['post', `/${id}/assinar`], ['post', `/${id}/publicar`], ['post', `/${id}/cancelar`, { note: 'x' }],
      ['get', `/${id}/versoes/${randomUUID()}/download`],
    ];
    for (const [m, path, body] of rotas) {
      const r = await (request(app.getHttpServer()) as any)[m](`${fluxo}${path}`).set(auth(tAdmin)).send(body ?? {});
      expect([m, path, r.status]).toEqual([m, path, 403]);
    }
  });

  it('auditoria: document_matrix.changed (categoria, usuário, nomes das ações) e professional_registration.* (só ids); nunca o número nem o conselho', async () => {
    await putMatriz(tAdmin, A.userId, ['elaborar', 'revisar'], 'lip');
    const novo = await apost(tAdmin, '/registros', novoReg(A.userId, '0003'));
    expect(novo.status).toBe(201);
    expect((await apost(tAdmin, `/registros/${novo.body.id}/confirmar`)).status).toBe(201);
    let rows: any[] = [];
    for (let i = 0; i < 40; i++) {
      rows = (await db.client.query(
        "SELECT action, resource_type, resource_id, method, path, status_code, detail FROM audit_log WHERE actor_user_id = $1 AND (action LIKE 'document_matrix.%' OR action LIKE 'professional_registration.%') ORDER BY occurred_at", [admin.userId])).rows;
      if (rows.some((r) => r.action === 'professional_registration.confirmed')) break;
      await new Promise((x) => setTimeout(x, 100));
    }
    const mat = rows.filter((r) => r.action === 'document_matrix.changed');
    expect(mat.length).toBeGreaterThan(0);
    const ultimo = mat[mat.length - 1];
    expect(ultimo.detail).toBe(`categoria: lip; usuario: ${A.userId}; acoes(2): elaborar, revisar`);
    expect(ultimo.path).toBe(`${adm}/matriz/lip/usuarios/${A.userId}`);
    const criado = rows.find((r) => r.action === 'professional_registration.created' && r.resource_id === novo.body.id);
    const confirmado = rows.find((r) => r.action === 'professional_registration.confirmed' && r.resource_id === novo.body.id);
    expect(criado.detail).toBe(`usuario: ${A.userId}`);
    expect(confirmado.detail).toBe(`usuario: ${A.userId}`);
    expect(criado.path).toBe(`${adm}/registros`);
    expect(confirmado.path).toBe(`${adm}/registros/${novo.body.id}/confirmar`);
    // varredura: sem conselho nem número (ids removidos antes de procurar '0000'/'0003')
    const texto = JSON.stringify(rows).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
    expect(texto).not.toMatch(/TESTE/i);
    expect(texto).not.toMatch(/0000|0003|registration_number|numero/i);
    await putMatriz(tAdmin, A.userId, [], 'lip');
  }, 60000);


  // -------------------------------------------------------------------------------------------
  // Fase 5C, Task 1: sócios e viabilidade (somente GET, somente admin).
  // -------------------------------------------------------------------------------------------
  const CATS = ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo', 'ltcat', 'lip', 'relatorio_visita'];
  const viab = async () => {
    const r = await aget(tAdmin, '/viabilidade');
    expect(r.status).toBe(200);
    return r.body as any[];
  };
  const porCat = (v: any[], c: string) => v.find((x) => x.category === c);
  const semearMatriz = async (cat: string, pares: [TestUserFixture, string[]][]) => {
    for (const [u, acoes] of pares) expect((await putMatriz(tAdmin, u.userId, acoes, cat)).status).toBe(200);
  };
  const apiFluxo = (t: string, method: 'post' | 'get', path: string, body: object = {}) =>
    (request(app.getHttpServer()) as any)[method](`/atuacao/documentos${path}`).set(auth(t)).send(body);
  const PDFV = (m: string) => Buffer.from(`%PDF-1.4\n% ${m}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

  it('GET socios: admin recebe {id, nome} dos sócios (sem outros papéis nem e-mail); sócio/empresa/técnico/parceiro => 403; sem token => 401', async () => {
    const r = await aget(tAdmin, '/socios');
    expect(r.status).toBe(200);
    const ids = r.body.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([A.userId, B.userId]));
    for (const u of [admin.userId, tecnicoUser.userId, parceiroUser.userId, montese.userId]) expect(ids).not.toContain(u);
    for (const x of r.body) expect(Object.keys(x).sort()).toEqual(['id', 'nome']);
    for (const t of [tA, tB, tEmp, tTec, tPar]) expect((await aget(t, '/socios')).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`${adm}/socios`)).status).toBe(401);
  });

  it('GET viabilidade: 403 para não-admin; cobre todas as categorias; categoria sem linhas => nao_configurada', async () => {
    for (const t of [tA, tB, tEmp, tTec, tPar]) expect((await aget(t, '/viabilidade')).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`${adm}/viabilidade`)).status).toBe(401);
    const v = await viab();
    expect(v.map((x) => x.category)).toEqual(CATS);
    const comLinhas = (await db.client.query('SELECT DISTINCT category FROM document_type_permissions')).rows.map((x: any) => x.category);
    const vazias = CATS.filter((c) => !comLinhas.includes(c));
    expect(vazias.length).toBeGreaterThan(0);
    for (const c of vazias) {
      expect(porCat(v, c)).toMatchObject({ status: 'nao_configurada', faltas: [], avisos: [] });
      expect(porCat(v, c).habilitados.every((h: any) => h.pessoas.length === 0)).toBe(true);
    }
    for (const c of v) {
      expect(c.habilitados.map((h: any) => h.acao)).toEqual(['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar']);
    }
  });

  it('viabilidade: registro_confirmado só em assinar; nunca conselho nem número; limpa dados após', async () => {
    await semearMatriz('relatorio_visita', [[A, ['elaborar']], [C, ['assinar']], [B, ['aprovar', 'publicar']]]);
    const reg = await apost(tAdmin, '/registros', novoReg(C.userId, '0000'));
    expect(reg.status).toBe(201);
    const antes = porCat(await viab(), 'relatorio_visita');
    expect(antes.status).toBe('inviavel'); // registro ainda pendente
    expect(antes.faltas).toContain('Ninguém habilitado a assinar com registro profissional confirmado.');
    expect(antes.habilitados.find((h: any) => h.acao === 'assinar').pessoas).toEqual([{ id: C.userId, nome: expect.any(String), registro_confirmado: false }]);
    expect((await apost(tAdmin, `/registros/${reg.body.id}/confirmar`)).status).toBe(201);
    const v = await viab();
    const dep = porCat(v, 'relatorio_visita');
    expect(dep.status).toBe('viavel');
    expect(dep.habilitados.find((h: any) => h.acao === 'assinar').pessoas[0]).toMatchObject({ id: C.userId, registro_confirmado: true });
    for (const h of dep.habilitados.filter((x: any) => x.acao !== 'assinar')) {
      for (const p of h.pessoas) expect(p).not.toHaveProperty('registro_confirmado');
    }
    // revogado deixa de contar
    expect((await apost(tAdmin, `/registros/${reg.body.id}/revogar`)).status).toBe(201);
    expect(porCat(await viab(), 'relatorio_visita').status).toBe('inviavel');
    const texto = JSON.stringify(v) + JSON.stringify(await aget(tAdmin, '/socios').then((r) => r.body));
    expect(texto).not.toMatch(/TESTE|council|registration|numero|"uf"/i);
    expect(texto.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')).not.toContain('0000');
    await semearMatriz('relatorio_visita', [[A, []], [B, []], [C, []]]);
  });

  it('coerência com o servidor: categoria "viavel" => elaborar, enviar, aprovar, assinar e publicar de fato funcionam', async () => {
    const CATV = 'cipa_ata';
    await semearMatriz(CATV, [[A, ['elaborar']], [D, ['aprovar', 'assinar', 'publicar']]]);
    const reg = await apost(tAdmin, '/registros', novoReg(D.userId, '0000'));
    expect((await apost(tAdmin, `/registros/${reg.body.id}/confirmar`)).status).toBe(201);
    expect(porCat(await viab(), CATV)).toMatchObject({ status: 'viavel', faltas: [] });

    const c = await apiFluxo(tA, 'post', '', { tenant_id: montese.tenantId, category: CATV, title: 'Titulo viabilidade' });
    expect(c.status).toBe(201);
    const id = c.body.id as string;
    const up = await request(app.getHttpServer()).post(`/atuacao/documentos/${id}/versoes`).set(auth(tA))
      .attach('file', PDFV('viab'), { filename: 'v.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect((await apiFluxo(tA, 'post', `/${id}/enviar-revisao`)).status).toBe(201);
    expect((await apiFluxo(tD, 'post', `/${id}/aprovar`)).status).toBe(201);
    expect((await apiFluxo(tD, 'post', `/${id}/assinar`)).status).toBe(201);
    expect((await apiFluxo(tD, 'post', `/${id}/publicar`)).status).toBe(201);
    expect((await db.client.query('SELECT status FROM document_drafts WHERE id=$1', [id])).rows[0].status).toBe('publicado');
  }, 60000);

  it('coerência com o servidor: categoria "inviavel" por falta de registro confirmado => assinar real dá 403', async () => {
    const CATI = 'cipa_anexo';
    await semearMatriz(CATI, [[A, ['elaborar']], [F, ['aprovar', 'assinar', 'publicar']]]);
    const pend = await apost(tAdmin, '/registros', novoReg(F.userId, '0000')); // pendente: não confirma
    expect(pend.status).toBe(201);
    const p = porCat(await viab(), CATI);
    expect(p.status).toBe('inviavel');
    expect(p.faltas).toEqual(['Ninguém habilitado a assinar com registro profissional confirmado.']);

    const c = await apiFluxo(tA, 'post', '', { tenant_id: montese.tenantId, category: CATI, title: 'Titulo inviavel' });
    const id = c.body.id as string;
    const up = await request(app.getHttpServer()).post(`/atuacao/documentos/${id}/versoes`).set(auth(tA))
      .attach('file', PDFV('inviavel'), { filename: 'v.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect((await apiFluxo(tA, 'post', `/${id}/enviar-revisao`)).status).toBe(201);
    expect((await apiFluxo(tF, 'post', `/${id}/aprovar`)).status).toBe(201);
    expect((await apiFluxo(tF, 'post', `/${id}/assinar`)).status).toBe(403);
    expect((await db.client.query('SELECT status FROM document_drafts WHERE id=$1', [id])).rows[0].status).toBe('aprovado');
    await semearMatriz(CATI, [[A, []], [F, []]]);
    await semearMatriz('cipa_ata', [[A, []], [D, []]]);
  }, 60000);

  it('viabilidade: a mesma pessoa elaborar e aprovar não é mais falta (separação desligada); admin segue 403 nas rotas do sócio', async () => {
    expect((await putMatriz(tAdmin, A.userId, ['elaborar', 'aprovar', 'assinar', 'publicar'], 'treinamento')).status).toBe(200);
    const t = porCat(await viab(), 'treinamento');
    expect(t.faltas).not.toContain('O único aprovador é também o único elaborador, e o aprovador não pode ser o elaborador.');
    expect(t.avisos).toEqual([]);
    await putMatriz(tAdmin, A.userId, [], 'treinamento');
    for (const [m, path] of [['get', ''], ['post', '']] as const) {
      expect([m, (await apiFluxo(tAdmin, m, path, m === 'post' ? { tenant_id: montese.tenantId, category: 'pgr', title: 'x' } : {})).status]).toEqual([m, 403]);
    }
    // somente GET: POST/PUT/DELETE em socios e viabilidade não existem
    for (const rota of ['/socios', '/viabilidade']) {
      for (const m of ['post', 'put', 'delete'] as const) {
        const r = await (request(app.getHttpServer()) as any)[m](`${adm}${rota}`).set(auth(tAdmin)).send({});
        expect([rota, m, r.status]).toEqual([rota, m, 404]);
      }
    }
  });

});
