import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel de Atuação, Fase 3B, Task 1: RLS de agenda_events e client_interactions
// (migration 0094). Conexão na role da aplicação (montese_app, sujeita a RLS),
// transação com set_config local, sempre com ROLLBACK. Asserções de dado leem
// pelo superusuário (db.client).
async function comoPapel<T>(
  role: string,
  userId: string,
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.role', $3, true)",
      [userId, tenantId, role],
    );
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}
const comoSocio = <T>(userId: string, fn: (c: Client) => Promise<T>) => comoPapel('socio', userId, '', fn);

// Lê TODAS as linhas de audit_log dos atores (inclusive as genéricas do AuditInterceptor)
// e garante que nenhum campo carrega os textos secretos usados nos corpos das requisições.
async function semTextoLivreNaAuditoria(actorIds: string[], segredos: string[]) {
  const dbx = new TestDb();
  await dbx.connect();
  try {
    const r = await dbx.client.query(
      'SELECT action, detail, path, resource_id, resource_type FROM audit_log WHERE actor_user_id = ANY($1)',
      [actorIds],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.some((x: any) => x.resource_type === 'atuacao')).toBe(true); // genéricas incluídas
    for (const row of r.rows) {
      for (const campo of ['detail', 'path', 'action', 'resource_id']) {
        for (const seg of segredos) expect(String(row[campo] ?? '')).not.toContain(seg);
      }
    }
  } finally {
    await dbx.disconnect();
  }
}

const INS_EVT =
  "INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date) VALUES ($1, $2, $3, 'reuniao', $4, '2030-01-15') RETURNING id";
const INS_INT =
  "INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, summary) VALUES ($1, $2, 'reuniao', '2030-01-15', $3) RETURNING id";

describe('atuacao-agenda — RLS de agenda_events/client_interactions (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let outroSocio: TestUserFixture;
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let comTecnico: { tenantId: string };
  let evMontese: string; // criado por socio
  let evTecnico: string;
  let intSocio: string; // interação de socio em Montese
  let intOutro: string; // interação de outroSocio em Montese
  let intTecnico: string;

  const contaTabelas = async (tenantIds: string[]) => ({
    ev: (await db.client.query('SELECT count(*)::int AS n FROM agenda_events WHERE tenant_id = ANY($1)', [tenantIds])).rows[0].n,
    it: (await db.client.query('SELECT count(*)::int AS n FROM client_interactions WHERE tenant_id = ANY($1)', [tenantIds])).rows[0].n,
  });

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Agenda');
    outroSocio = await db.createUserWithRole('socio', 'Outro Socio Agenda');
    admin = await db.createUserWithRole('admin', 'Admin Agenda');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Agenda');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Agenda');
    montese = await db.createTenantWithUser('Cliente Montese Agenda');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Agenda');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      comTecnico.tenantId,
      tec.rows[0].id,
    ]);
    const q = async (sql: string, p: any[]) => (await db.client.query(sql, p)).rows[0].id as string;
    evMontese = await q(INS_EVT, [montese.tenantId, socio.userId, socio.userId, 'Evento Montese']);
    evTecnico = await q(INS_EVT, [comTecnico.tenantId, socio.userId, socio.userId, 'Evento Tecnico']);
    intSocio = await q(INS_INT, [montese.tenantId, socio.userId, 'Interacao do socio']);
    intOutro = await q(INS_INT, [montese.tenantId, outroSocio.userId, 'Interacao do outro']);
    intTecnico = await q(INS_INT, [comTecnico.tenantId, socio.userId, 'Interacao Tecnico']);
  });

  afterAll(async () => {
    // tenants primeiro (cascata leva eventos/interações), depois users.
    await db.cleanup();
    await db.disconnect();
  });

  it('socio cria e lê agenda_events de tenant Montese; não em tenant de técnico', async () => {
    const r = await comoSocio(socio.userId, async (c) => {
      const ev = await c.query(INS_EVT, [montese.tenantId, outroSocio.userId, socio.userId, 'Criado pelo socio']);
      const it = await c.query(INS_INT, [montese.tenantId, socio.userId, 'Resumo criado']);
      const lidosEv = (await c.query('SELECT id FROM agenda_events WHERE id = ANY($1)', [[evMontese, evTecnico]])).rows.map((x: any) => x.id);
      const lidosIt = (await c.query('SELECT id FROM client_interactions WHERE id = ANY($1)', [[intSocio, intOutro, intTecnico]])).rows
        .map((x: any) => x.id)
        .sort();
      const proprio = (await c.query('SELECT title FROM agenda_events WHERE id = $1', [ev.rows[0].id])).rows;
      return { evIns: ev.rowCount, itIns: it.rowCount, lidosEv, lidosIt, proprio };
    });
    expect(r.evIns).toBe(1);
    expect(r.itIns).toBe(1);
    expect(r.lidosEv).toEqual([evMontese]);
    expect(r.lidosIt).toEqual([intSocio, intOutro].sort());
    expect(r.proprio).toEqual([{ title: 'Criado pelo socio' }]);

    await expect(
      comoSocio(socio.userId, (c) => c.query(INS_EVT, [comTecnico.tenantId, socio.userId, socio.userId, 'Invasor'])),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoSocio(socio.userId, (c) => c.query(INS_INT, [comTecnico.tenantId, socio.userId, 'Invasora'])),
    ).rejects.toThrow(/row-level security/i);

    // ROLLBACK: nada persistiu
    expect(await contaTabelas([montese.tenantId, comTecnico.tenantId])).toEqual({ ev: 2, it: 3 });
    const t = await db.client.query("SELECT count(*)::int AS n FROM agenda_events WHERE title IN ('Criado pelo socio','Invasor')");
    expect(t.rows[0].n).toBe(0);
  });

  it('socio não faz DELETE em agenda_events nem em client_interactions', async () => {
    const r = await comoSocio(socio.userId, async (c) => ({
      delEv: (await c.query('DELETE FROM agenda_events WHERE id = $1', [evMontese])).rowCount,
      delIt: (await c.query('DELETE FROM client_interactions WHERE id = $1', [intSocio])).rowCount,
    }));
    expect(r.delEv).toBe(0);
    expect(r.delIt).toBe(0);
    const e = await db.client.query('SELECT title FROM agenda_events WHERE id = $1', [evMontese]);
    expect(e.rows).toEqual([{ title: 'Evento Montese' }]);
    const i = await db.client.query('SELECT summary FROM client_interactions WHERE id = $1', [intSocio]);
    expect(i.rows).toEqual([{ summary: 'Interacao do socio' }]);
  });

  it('socio não insere evento com created_by de outro usuário nem em tenant de técnico', async () => {
    await expect(
      comoSocio(socio.userId, (c) => c.query(INS_EVT, [montese.tenantId, socio.userId, outroSocio.userId, 'Falsa autoria'])),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoSocio(socio.userId, (c) => c.query(INS_INT, [montese.tenantId, outroSocio.userId, 'Falsa autoria int'])),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoSocio(socio.userId, (c) => c.query(INS_EVT, [comTecnico.tenantId, socio.userId, socio.userId, 'Tenant tecnico'])),
    ).rejects.toThrow(/row-level security/i);
    const e = await db.client.query("SELECT count(*)::int AS n FROM agenda_events WHERE title IN ('Falsa autoria','Tenant tecnico')");
    expect(e.rows[0].n).toBe(0);
    const i = await db.client.query("SELECT count(*)::int AS n FROM client_interactions WHERE summary = 'Falsa autoria int'");
    expect(i.rows[0].n).toBe(0);
  });

  it('empresa, técnico e parceiro leem 0 linhas de agenda_events e client_interactions (conexão própria com set_config)', async () => {
    const atores: Array<[string, string, string]> = [
      ['empresa', montese.userId, montese.tenantId],
      ['tecnico', tecnicoUser.userId, comTecnico.tenantId],
      ['parceiro', parceiroUser.userId, ''],
    ];
    for (const [role, uid, tid] of atores) {
      const r = await comoPapel(role, uid, tid, async (c) => ({
        ev: (await c.query('SELECT id FROM agenda_events')).rowCount,
        it: (await c.query('SELECT id FROM client_interactions')).rowCount,
        updEv: (await c.query("UPDATE agenda_events SET title = 'hack'")).rowCount,
        updIt: (await c.query("UPDATE client_interactions SET summary = 'hack'")).rowCount,
        delEv: (await c.query('DELETE FROM agenda_events')).rowCount,
        delIt: (await c.query('DELETE FROM client_interactions')).rowCount,
      }));
      expect({ role, ...r }).toEqual({ role, ev: 0, it: 0, updEv: 0, updIt: 0, delEv: 0, delIt: 0 });
      await expect(
        comoPapel(role, uid, tid, (c) => c.query(INS_EVT, [tid || montese.tenantId, uid, uid, 'Intruso'])),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await expect(
        comoPapel(role, uid, tid, (c) => c.query(INS_INT, [tid || montese.tenantId, uid, 'Intrusa'])),
      ).rejects.toThrow(/row-level security|permission denied/i);
    }
    const real = await contaTabelas([montese.tenantId, comTecnico.tenantId]);
    expect(real).toEqual({ ev: 2, it: 3 });
    const t = await db.client.query('SELECT title FROM agenda_events WHERE tenant_id = ANY($1) ORDER BY title', [
      [montese.tenantId, comTecnico.tenantId],
    ]);
    expect(t.rows.map((x: any) => x.title)).toEqual(['Evento Montese', 'Evento Tecnico']);
  });

  it('admin lê as duas tabelas e não as altera', async () => {
    const r = await comoPapel('admin', admin.userId, '', async (c) => ({
      ev: (await c.query('SELECT id FROM agenda_events WHERE id = ANY($1)', [[evMontese, evTecnico]])).rows.length,
      it: (await c.query('SELECT id FROM client_interactions WHERE id = ANY($1)', [[intSocio, intOutro, intTecnico]])).rows.length,
      updEv: (await c.query("UPDATE agenda_events SET title = 'x'")).rowCount,
      updIt: (await c.query("UPDATE client_interactions SET summary = 'x'")).rowCount,
      delEv: (await c.query('DELETE FROM agenda_events')).rowCount,
      delIt: (await c.query('DELETE FROM client_interactions')).rowCount,
    }));
    expect(r).toEqual({ ev: 2, it: 3, updEv: 0, updIt: 0, delEv: 0, delIt: 0 });
    await expect(
      comoPapel('admin', admin.userId, '', (c) => c.query(INS_EVT, [montese.tenantId, admin.userId, admin.userId, 'Admin insere'])),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoPapel('admin', admin.userId, '', (c) => c.query(INS_INT, [montese.tenantId, admin.userId, 'Admin insere'])),
    ).rejects.toThrow(/row-level security/i);
    expect(await contaTabelas([montese.tenantId, comTecnico.tenantId])).toEqual({ ev: 2, it: 3 });
    const e = await db.client.query('SELECT title FROM agenda_events WHERE id = $1', [evMontese]);
    expect(e.rows[0].title).toBe('Evento Montese');
  });

  it('socio edita só a PRÓPRIA interação (outra: 0 linhas afetadas); edita qualquer agenda_event de Montese', async () => {
    const r = await comoSocio(outroSocio.userId, async (c) => {
      const propria = await c.query("UPDATE client_interactions SET summary = 'editada' WHERE id = $1 RETURNING summary", [intOutro]);
      const alheia = await c.query("UPDATE client_interactions SET summary = 'editada' WHERE id = $1", [intSocio]);
      const evQualquer = await c.query("UPDATE agenda_events SET status = 'concluido' WHERE id = $1 RETURNING status", [evMontese]);
      const evTec = await c.query("UPDATE agenda_events SET status = 'concluido' WHERE id = $1", [evTecnico]);
      const itTec = await c.query("UPDATE client_interactions SET summary = 'editada' WHERE id = $1", [intTecnico]);
      return { propria: propria.rows, alheia: alheia.rowCount, evQualquer: evQualquer.rows, evTec: evTec.rowCount, itTec: itTec.rowCount };
    });
    expect(r.propria).toEqual([{ summary: 'editada' }]);
    expect(r.alheia).toBe(0);
    expect(r.evQualquer).toEqual([{ status: 'concluido' }]);
    expect(r.evTec).toBe(0);
    expect(r.itTec).toBe(0);

    // não pode repassar autoria da própria interação (trigger de guarda dispara antes do WITH CHECK da RLS)
    await expect(
      comoSocio(outroSocio.userId, (c) => c.query('UPDATE client_interactions SET created_by = $2 WHERE id = $1', [intOutro, socio.userId])),
    ).rejects.toThrow(/imutáve|row-level security/i);

    // ROLLBACK: tudo intacto
    const i = await db.client.query('SELECT id, summary, created_by FROM client_interactions WHERE id = ANY($1) ORDER BY summary', [
      [intSocio, intOutro, intTecnico],
    ]);
    expect(i.rows.map((x: any) => x.summary).sort()).toEqual(['Interacao Tecnico', 'Interacao do outro', 'Interacao do socio'].sort());
    expect(i.rows.find((x: any) => x.id === intOutro).created_by).toBe(outroSocio.userId);
    const e = await db.client.query('SELECT id, status FROM agenda_events WHERE id = ANY($1)', [[evMontese, evTecnico]]);
    expect(e.rows.every((x: any) => x.status === 'agendado')).toBe(true);
  });

  it('triggers de guarda: tenant_id/created_by imutáveis, evento encerrado imutável, edição legítima e updated_at preservados (montese_app e superusuário)', async () => {
    const outra = await db.createTenantWithUser('Outro Montese Agenda Guard');
    const q = async (sql: string, p: any[]) => (await db.client.query(sql, p)).rows[0].id as string;
    const novoEvt = (title: string, status = 'agendado') =>
      q(
        "INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date, status, outcome_note) VALUES ($1,$2,$2,'reuniao',$3,'2030-01-15',$4, CASE WHEN $4 = 'agendado' THEN NULL ELSE 'nota' END) RETURNING id",
        [montese.tenantId, socio.userId, title, status],
      );
    const evtLinha = async (id: string) =>
      (await db.client.query('SELECT tenant_id, created_by, title, status, notes, outcome_note, updated_at FROM agenda_events WHERE id = $1', [id])).rows[0];
    const intLinha = async (id: string) =>
      (await db.client.query('SELECT tenant_id, created_by, summary FROM client_interactions WHERE id = $1', [id])).rows[0];

    const executores: Array<[string, (fn: (c: Client) => Promise<any>) => Promise<any>]> = [
      ['montese_app/socio', (fn) => comoSocio(socio.userId, fn)],
      ['superusuario', (fn) => fn(db.client)],
    ];
    for (const [nome, exec] of executores) {
      const ag = await novoEvt(`Guard agendado ${nome}`);
      const conc = await novoEvt(`Guard concluido ${nome}`, 'concluido');
      const canc = await novoEvt(`Guard cancelado ${nome}`, 'cancelado');
      const inter = await q(INS_INT, [montese.tenantId, socio.userId, `Resumo guard ${nome}`]);
      const antesAg = await evtLinha(ag);
      const antesConc = await evtLinha(conc);
      const antesCanc = await evtLinha(canc);
      const antesInt = await intLinha(inter);

      // mover para outro tenant Montese e trocar created_by
      await expect(exec((c) => c.query('UPDATE agenda_events SET tenant_id = $2 WHERE id = $1', [ag, outra.tenantId]))).rejects.toThrow(/imutáve/i);
      await expect(exec((c) => c.query('UPDATE agenda_events SET created_by = $2 WHERE id = $1', [ag, outroSocio.userId]))).rejects.toThrow(/imutáve/i);
      await expect(exec((c) => c.query('UPDATE client_interactions SET tenant_id = $2 WHERE id = $1', [inter, outra.tenantId]))).rejects.toThrow(/imutáve/i);
      await expect(exec((c) => c.query('UPDATE client_interactions SET created_by = $2 WHERE id = $1', [inter, outroSocio.userId]))).rejects.toThrow(/imutáve/i);
      // reabrir e editar evento encerrado
      for (const id of [conc, canc]) {
        await expect(exec((c) => c.query("UPDATE agenda_events SET status = 'agendado' WHERE id = $1", [id]))).rejects.toThrow(/encerrado/i);
        await expect(exec((c) => c.query("UPDATE agenda_events SET title = 'Alterado' WHERE id = $1", [id]))).rejects.toThrow(/encerrado/i);
        await expect(exec((c) => c.query("UPDATE agenda_events SET outcome_note = 'outra' WHERE id = $1", [id]))).rejects.toThrow(/encerrado/i);
        await expect(exec((c) => c.query("UPDATE agenda_events SET status = CASE status WHEN 'concluido' THEN 'cancelado' ELSE 'concluido' END WHERE id = $1", [id]))).rejects.toThrow(/encerrado/i);
      }
      // dado intacto (lido pelo superusuário)
      expect(await evtLinha(ag)).toEqual(antesAg);
      expect(await evtLinha(conc)).toEqual(antesConc);
      expect(await evtLinha(canc)).toEqual(antesCanc);
      expect(await intLinha(inter)).toEqual(antesInt);

      // edições legítimas continuam funcionando e set_updated_at continua rodando
      const legit = await exec(async (c) => ({
        titulo: (await c.query("UPDATE agenda_events SET title = 'Titulo novo' WHERE id = $1 RETURNING title, updated_at", [ag])).rows,
        fecha: (await c.query("UPDATE agenda_events SET status = 'concluido', outcome_note = 'ok' WHERE id = $1 RETURNING status", [ag])).rows,
        resumo: (await c.query("UPDATE client_interactions SET summary = 'Resumo novo' WHERE id = $1 RETURNING summary, updated_at", [inter])).rows,
        // só updated_at mudando em evento encerrado não é mudança de negócio
        soUpdatedAt: (await c.query('UPDATE agenda_events SET updated_at = now() WHERE id = $1', [conc])).rowCount,
      }));
      expect(legit.titulo[0].title).toBe('Titulo novo');
      expect(legit.titulo[0].updated_at.getTime()).toBeGreaterThan(antesAg.updated_at.getTime());
      expect(legit.fecha).toEqual([{ status: 'concluido' }]);
      expect(legit.resumo[0].summary).toBe('Resumo novo');
      expect(legit.resumo[0].updated_at.getTime()).toBeGreaterThan(new Date(0).getTime());
      expect(legit.soUpdatedAt).toBe(1);
      if (nome === 'superusuario') {
        const depois = await evtLinha(ag);
        expect(depois).toMatchObject({ title: 'Titulo novo', status: 'concluido', tenant_id: montese.tenantId, created_by: socio.userId });
        expect((await intLinha(inter)).summary).toBe('Resumo novo');
      } else {
        expect(await evtLinha(ag)).toEqual(antesAg); // ROLLBACK
      }
    }

    // FK ON DELETE SET NULL de unidade não pode ser bloqueada por evento encerrado
    const unit = await q(
      "INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip) VALUES ($1,'Unid Guard','Rua','Cidade','SP','01000000') RETURNING id",
      [montese.tenantId],
    );
    const comUnit = await q(
      "INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date, status, company_unit_id) VALUES ($1,$2,$2,'visita','Encerrado com unidade','2030-01-15','concluido',$3) RETURNING id",
      [montese.tenantId, socio.userId, unit],
    );
    await db.client.query('DELETE FROM company_units WHERE id = $1', [unit]);
    const ap = await db.client.query('SELECT company_unit_id, status, title FROM agenda_events WHERE id = $1', [comUnit]);
    expect(ap.rows).toEqual([{ company_unit_id: null, status: 'concluido', title: 'Encerrado com unidade' }]);
  });

  it('CHECKs no banco: end_time <= start_time, meeting_link http e type inválido são rejeitados; válidos passam', async () => {
    const base = [montese.tenantId, socio.userId];
    const ins = (cols: string, vals: string) =>
      db.client.query(
        `INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date${cols}) VALUES ($1,$2,$2,'reuniao','Check','2030-01-15'${vals})`,
        base,
      );
    await expect(ins(', start_time, end_time', ", '10:00', '10:00'")).rejects.toThrow(/check constraint/i);
    await expect(ins(', start_time, end_time', ", '10:00', '09:00'")).rejects.toThrow(/check constraint/i);
    await expect(ins(', meeting_link', ", 'http://meet.example.com/x'")).rejects.toThrow(/check constraint/i);
    await expect(
      db.client.query(
        "INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date) VALUES ($1,$2,$2,'invalido','Check','2030-01-15')",
        base,
      ),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.client.query(
        "INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, summary) VALUES ($1,$2,'invalido','2030-01-15','x')",
        base,
      ),
    ).rejects.toThrow(/check constraint/i);
    const nenhum = await db.client.query("SELECT count(*)::int AS n FROM agenda_events WHERE title = 'Check'");
    expect(nenhum.rows[0].n).toBe(0);

    // válidos passam (e comprovam que os CHECKs não bloqueiam tudo)
    await ins(', start_time, end_time, meeting_link', ", '10:00', '10:30', 'https://meet.example.com/x'");
    await ins('', '');
    const ok = await db.client.query("SELECT count(*)::int AS n FROM agenda_events WHERE title = 'Check'");
    expect(ok.rows[0].n).toBe(2);
  });
});

describe('atuacao-agenda — HTTP (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socioA: TestUserFixture;
  let socioB: TestUserFixture;
  let semPerm: TestUserFixture; // socio sem appointments.manage
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let montese: { tenantId: string; email: string; password: string };
  let comTecnico: { tenantId: string };
  let unidadeMontese: string;
  let unidadeOutra: string;
  let tA: string;
  let tB: string;
  let tSem: string;

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const tenants = () => [montese.tenantId, comTecnico.tenantId];
  const contaEventos = async () =>
    (await db.client.query('SELECT count(*)::int AS n FROM agenda_events WHERE tenant_id = ANY($1)', [tenants()])).rows[0].n as number;
  const criar = (t: string, body: any) => http().post('/atuacao/agenda').set(auth(t)).send(body);
  const status = (t: string, id: string, body: any) => http().post(`/atuacao/agenda/${id}/status`).set(auth(t)).send(body);
  const patch = (t: string, id: string, body: any) => http().patch(`/atuacao/agenda/${id}`).set(auth(t)).send(body);
  const linha = async (id: string) =>
    (
      await db.client.query(
        "SELECT status, outcome_note, created_by, owner_user_id, title, to_char(event_date,'YYYY-MM-DD') AS event_date, to_char(start_time,'HH24:MI') AS start_time FROM agenda_events WHERE id = $1",
        [id],
      )
    ).rows[0];
  const corpo = (extra: any = {}) => ({ tenant_id: montese.tenantId, type: 'reuniao', title: 'Reunião de rotina', event_date: '2031-03-10', ...extra });

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    socioA = await db.createUserWithRole('socio', 'Socio Ag A');
    socioB = await db.createUserWithRole('socio', 'Socio Ag B');
    semPerm = await db.createUserWithRole('socio', 'Socio Ag SemPerm');
    admin = await db.createUserWithRole('admin', 'Admin Ag Http');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Ag Http');
    montese = await db.createTenantWithUser('Cliente Montese Ag Http');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Ag Http');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [comTecnico.tenantId, tec.rows[0].id]);
    const mkUnit = async (tenantId: string) =>
      (
        await db.client.query(
          `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
           VALUES ($1, 'Unidade Ag', 'Rua A', 'Cidade', 'SP', '01000000') RETURNING id`,
          [tenantId],
        )
      ).rows[0].id as string;
    unidadeMontese = await mkUnit(montese.tenantId);
    unidadeOutra = await mkUnit(comTecnico.tenantId);
    for (const u of [socioA, socioB]) await db.grantSocioPermission(u.userId, 'appointments.manage');
    await db.grantSocioPermission(semPerm.userId, 'tasks.read');
    tA = await login(socioA.email, socioA.password);
    tB = await login(socioB.email, socioB.password);
    tSem = await login(semPerm.email, semPerm.password);
  });

  afterAll(async () => {
    const ids = [socioA, socioB, semPerm].map((u) => u.userId);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [ids]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('dois sócios criam, leem e atualizam; created_by e responsável vêm do JWT/validação', async () => {
    const r = await criar(tA, corpo({ start_time: '09:00', end_time: '10:00', location: 'Sala 1', meeting_link: 'https://meet.example.com/abc', company_unit_id: unidadeMontese, notes: 'pauta x' }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'agendado', owner_user_id: socioA.userId, owner_name: 'Socio Ag A', created_by_name: 'Socio Ag A',
      event_date: '2031-03-10', start_time: '09:00', end_time: '10:00', company_unit_id: unidadeMontese,
    });
    expect(r.body.tenant_name).toContain('Cliente Montese Ag Http');
    const db1 = await linha(r.body.id);
    expect(db1).toMatchObject({ created_by: socioA.userId, owner_user_id: socioA.userId, status: 'agendado' });

    const lidoB = await http().get(`/atuacao/agenda/${r.body.id}`).set(auth(tB));
    expect(lidoB.status).toBe(200);
    expect(lidoB.body.title).toBe('Reunião de rotina');

    // B delega o evento para si e ajusta o título; created_by não muda
    const up = await patch(tB, r.body.id, { title: '  Novo título  ', owner_user_id: socioB.userId, location: 'Sala 2' });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ title: 'Novo título', owner_name: 'Socio Ag B', location: 'Sala 2', created_by_name: 'Socio Ag A' });
    expect(await linha(r.body.id)).toMatchObject({ title: 'Novo título', owner_user_id: socioB.userId, created_by: socioA.userId });

    // responsável de fora de list_socios (admin) é rejeitado e nada muda
    const ruim = await patch(tA, r.body.id, { owner_user_id: admin.userId });
    expect(ruim.status).toBe(400);
    expect((await linha(r.body.id)).owner_user_id).toBe(socioB.userId);
    expect((await criar(tA, corpo({ owner_user_id: admin.userId }))).status).toBe(400);
    // responsável explícito válido
    const comResp = await criar(tA, corpo({ owner_user_id: socioB.userId }));
    expect(comResp.status).toBe(201);
    expect((await linha(comResp.body.id))).toMatchObject({ owner_user_id: socioB.userId, created_by: socioA.userId });
  });

  it('sem appointments.manage => 403 em tudo e nada é criado', async () => {
    const antes = await contaEventos();
    const alvo = '00000000-0000-4000-8000-000000000000';
    expect((await criar(tSem, corpo())).status).toBe(403);
    expect((await http().get('/atuacao/agenda').set(auth(tSem))).status).toBe(403);
    expect((await http().get(`/atuacao/agenda/${alvo}`).set(auth(tSem))).status).toBe(403);
    expect((await patch(tSem, alvo, { title: 'x' })).status).toBe(403);
    expect((await status(tSem, alvo, { status: 'concluido' })).status).toBe(403);
    expect(await contaEventos()).toBe(antes);
  });

  it('tenant de técnico => 404 e nada criado; unidade de outro tenant => 400', async () => {
    const antes = await contaEventos();
    expect((await criar(tA, corpo({ tenant_id: comTecnico.tenantId }))).status).toBe(404);
    expect((await criar(tA, corpo({ company_unit_id: unidadeOutra }))).status).toBe(400);
    expect(await contaEventos()).toBe(antes);
    const ev = await criar(tA, corpo({ title: 'Unidade' }));
    expect((await patch(tA, ev.body.id, { company_unit_id: unidadeOutra })).status).toBe(400);
    expect((await linha(ev.body.id)).title).toBe('Unidade');
    const row = await db.client.query('SELECT company_unit_id FROM agenda_events WHERE id = $1', [ev.body.id]);
    expect(row.rows[0].company_unit_id).toBeNull();
  });

  it('validação: created_by no corpo, datas/horas inválidas, null no PATCH, link http => 400; https => 201', async () => {
    const antes = await contaEventos();
    const invalidos = [
      corpo({ created_by: socioB.userId }),
      corpo({ event_date: '2031-02-30' }),
      corpo({ event_date: '10/03/2031' }),
      corpo({ start_time: '25:00' }),
      corpo({ start_time: '9:30' }),
      corpo({ start_time: '10:00', end_time: '10:00' }),
      corpo({ start_time: '10:00', end_time: '09:00' }),
      corpo({ title: '   ' }),
      corpo({ type: 'festa' }),
      corpo({ meeting_link: 'http://meet.example.com/x' }),
      corpo({ meeting_link: 'ftp://x' }),
    ];
    for (const b of invalidos) expect((await criar(tA, b)).status).toBe(400);
    expect(await contaEventos()).toBe(antes);

    const ok = await criar(tA, corpo({ title: 'Link ok', meeting_link: 'https://meet.example.com/x' }));
    expect(ok.status).toBe(201);
    expect(ok.body.meeting_link).toBe('https://meet.example.com/x');

    for (const campo of ['title', 'event_date', 'start_time', 'location', 'meeting_link', 'notes', 'type', 'owner_user_id', 'company_unit_id']) {
      expect((await patch(tA, ok.body.id, { [campo]: null })).status).toBe(400);
    }
    expect((await patch(tA, ok.body.id, { created_by: socioB.userId })).status).toBe(400);
    expect((await patch(tA, ok.body.id, { status: 'concluido' })).status).toBe(400);
    expect((await patch(tA, ok.body.id, { tenant_id: comTecnico.tenantId })).status).toBe(400);
    expect((await patch(tA, ok.body.id, { meeting_link: 'http://x.com' })).status).toBe(400);
    expect(await linha(ok.body.id)).toMatchObject({ title: 'Link ok', status: 'agendado', created_by: socioA.userId });
    expect((await http().get('/atuacao/agenda/nao-uuid').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/agenda?foo=1').set(auth(tA))).status).toBe(400);
  });

  it('horário no PATCH é validado contra o valor salvo', async () => {
    const ev = await criar(tA, corpo({ title: 'Horário', start_time: '10:00', end_time: '11:00' }));
    expect((await patch(tA, ev.body.id, { end_time: '09:30' })).status).toBe(400);
    expect((await patch(tA, ev.body.id, { start_time: '11:30' })).status).toBe(400);
    expect(await linha(ev.body.id)).toMatchObject({ start_time: '10:00' });
    const ok = await patch(tA, ev.body.id, { start_time: '10:30', end_time: '11:30' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ start_time: '10:30', end_time: '11:30' });
  });

  it('status: cancelar sem nota => 400; concluir evento cancelado => 400 e status intacto; evento encerrado não edita', async () => {
    const ev = await criar(tA, corpo({ title: 'Ciclo' }));
    const id = ev.body.id;
    expect((await status(tA, id, { status: 'cancelado' })).status).toBe(400);
    expect((await status(tA, id, { status: 'cancelado', note: '   ' })).status).toBe(400);
    expect((await status(tA, id, { status: 'agendado' })).status).toBe(400);
    expect((await linha(id)).status).toBe('agendado');

    const canc = await status(tB, id, { status: 'cancelado', note: 'Cliente pediu' });
    expect(canc.status).toBe(201);
    expect(canc.body).toMatchObject({ status: 'cancelado', outcome_note: 'Cliente pediu' });
    expect(await linha(id)).toMatchObject({ status: 'cancelado', outcome_note: 'Cliente pediu' });

    const re = await status(tA, id, { status: 'concluido', note: 'tarde demais' });
    expect(re.status).toBe(400);
    expect(await linha(id)).toMatchObject({ status: 'cancelado', outcome_note: 'Cliente pediu' });
    const ed = await patch(tA, id, { title: 'Mudou' });
    expect(ed.status).toBe(400);
    expect(ed.body.message).toBe('Evento encerrado');
    expect((await linha(id)).title).toBe('Ciclo');

    const ev2 = await criar(tA, corpo({ title: 'Concluir' }));
    const ok = await status(tA, ev2.body.id, { status: 'concluido', note: 'ok' });
    expect(ok.status).toBe(201);
    expect(await linha(ev2.body.id)).toMatchObject({ status: 'concluido', outcome_note: 'ok' });
    expect((await status(tA, ev2.body.id, { status: 'cancelado', note: 'x' })).status).toBe(400);
    expect((await linha(ev2.body.id)).status).toBe('concluido');
  });

  it('listagem: owner=me, período, status, tenantId; to < from => 400; ordenação e LIMIT', async () => {
    const mk = (extra: any) => criar(tA, corpo(extra));
    const a = await mk({ title: 'L1', event_date: '2032-05-10', start_time: '14:00', owner_user_id: socioA.userId });
    const b = await mk({ title: 'L2', event_date: '2032-05-10', start_time: '08:00', owner_user_id: socioA.userId });
    const c = await mk({ title: 'L3', event_date: '2032-05-20', owner_user_id: socioB.userId });
    const d = await mk({ title: 'L4', event_date: '2032-06-01', owner_user_id: socioA.userId });
    await status(tA, d.body.id, { status: 'concluido' });
    const ids = (r: any) => r.body.map((x: any) => x.id);

    const meA = await http().get('/atuacao/agenda?owner=me&from=2032-05-01&to=2032-06-30').set(auth(tA));
    expect(meA.status).toBe(200);
    expect(ids(meA)).toEqual([b.body.id, a.body.id, d.body.id]); // data, depois hora
    expect(meA.body[0]).toMatchObject({ title: 'L2', tenant_name: expect.any(String), owner_name: 'Socio Ag A', start_time: '08:00' });
    const meB = await http().get('/atuacao/agenda?owner=me&from=2032-05-01&to=2032-06-30').set(auth(tB));
    expect(ids(meB)).toEqual([c.body.id]);
    const porUuid = await http().get(`/atuacao/agenda?owner=${socioB.userId}&from=2032-05-01&to=2032-06-30`).set(auth(tA));
    expect(ids(porUuid)).toEqual([c.body.id]);
    const periodo = await http().get('/atuacao/agenda?from=2032-05-11&to=2032-05-31').set(auth(tA));
    expect(ids(periodo)).toEqual([c.body.id]);
    const conc = await http().get(`/atuacao/agenda?status=concluido&tenantId=${montese.tenantId}&from=2032-05-01&to=2032-06-30`).set(auth(tA));
    expect(ids(conc)).toEqual([d.body.id]);
    expect((await http().get('/atuacao/agenda?from=2032-06-01&to=2032-05-01').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/agenda?from=2032-13-01').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/agenda?owner=x').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/agenda?status=foo').set(auth(tA))).status).toBe(400);
    // evento de tenant de técnico (inserido direto) nunca aparece
    await db.client.query(
      "INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date) VALUES ($1,$2,$2,'outro','Tecnico','2032-05-15')",
      [comTecnico.tenantId, socioA.userId],
    );
    const todos = await http().get('/atuacao/agenda?from=2032-05-01&to=2032-06-30').set(auth(tA));
    expect(todos.body.map((x: any) => x.title)).not.toContain('Tecnico');
    const doTec = await http().get(`/atuacao/agenda?tenantId=${comTecnico.tenantId}`).set(auth(tA));
    expect(doTec.body).toEqual([]);
    const detTec = await db.client.query("SELECT id FROM agenda_events WHERE title = 'Tecnico'");
    expect((await http().get(`/atuacao/agenda/${detTec.rows[0].id}`).set(auth(tA))).status).toBe(404);
    expect((await patch(tA, detTec.rows[0].id, { title: 'x' })).status).toBe(404);
    expect((await status(tA, detTec.rows[0].id, { status: 'concluido' })).status).toBe(404);
    expect((await linha(detTec.rows[0].id))).toMatchObject({ title: 'Tecnico', status: 'agendado' });
  });

  it('empresa, técnico e admin => 403 em /atuacao/agenda*', async () => {
    const tokens = [
      await login(montese.email, montese.password),
      await login(tecnicoUser.email, tecnicoUser.password),
      await login(admin.email, admin.password),
    ];
    const antes = await contaEventos();
    const alvo = '00000000-0000-4000-8000-000000000000';
    for (const t of tokens) {
      expect((await http().get('/atuacao/agenda').set(auth(t))).status).toBe(403);
      expect((await http().get(`/atuacao/agenda/${alvo}`).set(auth(t))).status).toBe(403);
      expect((await criar(t, corpo())).status).toBe(403);
      expect((await patch(t, alvo, { title: 'x' })).status).toBe(403);
      expect((await status(t, alvo, { status: 'concluido' })).status).toBe(403);
    }
    expect(await contaEventos()).toBe(antes);
  });

  it('auditoria agenda.created/rescheduled/completed/cancelled sem título, pauta ou nota', async () => {
    const titulo = 'TituloSecretoAg123';
    const pauta = 'PautaSecretaAg456';
    const nota = 'NotaSecretaAg789';
    const ev = await criar(tA, corpo({ title: titulo, notes: pauta, start_time: '09:00' }));
    const id = ev.body.id;
    await patch(tA, id, { title: `${titulo}2`, notes: pauta }); // não reagenda
    await patch(tB, id, { event_date: '2031-04-01', start_time: '09:00' });
    await status(tB, id, { status: 'concluido', note: nota });
    const ev2 = await criar(tA, corpo({ title: titulo }));
    await status(tA, ev2.body.id, { status: 'cancelado', note: nota });

    const q = (rid: string) =>
      db.client.query("SELECT action, detail, actor_user_id, status_code, resource_type FROM audit_log WHERE resource_id = $1 AND action LIKE 'agenda.%' ORDER BY occurred_at", [rid]);
    const a1 = await q(id);
    expect(a1.rows.map((x: any) => x.action)).toEqual(['agenda.created', 'agenda.rescheduled', 'agenda.completed']);
    expect(a1.rows.map((x: any) => x.actor_user_id)).toEqual([socioA.userId, socioB.userId, socioB.userId]);
    expect(a1.rows.map((x: any) => x.status_code)).toEqual([201, 200, 201]);
    const a2 = await q(ev2.body.id);
    expect(a2.rows.map((x: any) => x.action)).toEqual(['agenda.created', 'agenda.cancelled']);
    for (const row of [...a1.rows, ...a2.rows]) {
      const txt = JSON.stringify(row);
      expect(txt).not.toContain('Secret');
      expect(row.resource_type).toBe('agenda_event');
    }
    await semTextoLivreNaAuditoria([socioA.userId, socioB.userId], ['TituloSecretoAg', 'PautaSecretaAg', 'NotaSecretaAg']);
  });

  it('auditoria: path das linhas agenda.* não tem query string; o interceptor global ainda grava a query string (achado documentado)', async () => {
    const ev = await criar(tA, corpo({ start_time: '09:00' }));
    const id = ev.body.id;
    const r = await http().patch(`/atuacao/agenda/${id}?ref=QueryLivreXyz`).set(auth(tA)).send({ event_date: '2031-05-01', start_time: '10:00' });
    expect(r.status).toBe(200);
    const nossas = await db.client.query("SELECT path FROM audit_log WHERE resource_id = $1 AND action LIKE 'agenda.%'", [id]);
    expect(nossas.rows.length).toBe(2);
    for (const row of nossas.rows) expect(row.path).not.toContain('?');
    expect(nossas.rows.map((x: any) => x.path)).toContain(`/atuacao/agenda/${id}`);
    // ACHADO (fora de escopo, interceptor global): grava originalUrl com query string em linhas resource_type 'atuacao'.
    const genericas = await db.client.query(
      "SELECT path FROM audit_log WHERE actor_user_id = $1 AND resource_type = 'atuacao' AND path LIKE '%QueryLivreXyz%'",
      [socioA.userId],
    );
    expect(genericas.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('atuacao-agenda — interações HTTP (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socioA: TestUserFixture;
  let socioB: TestUserFixture;
  let soLeitura: TestUserFixture; // clients.read, sem update_operational
  let semPerm: TestUserFixture; // nenhuma das duas
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let montese: { tenantId: string; email: string; password: string };
  let outraMontese: { tenantId: string };
  let comTecnico: { tenantId: string };
  let evMontese: string;
  let evOutra: string;
  let tA: string;
  let tB: string;
  let tLeit: string;
  let tSem: string;

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const rota = (tenantId: string) => `/atuacao/clientes/${tenantId}/interacoes`;
  const criar = (t: string, body: any, tenantId = montese.tenantId) => http().post(rota(tenantId)).set(auth(t)).send(body);
  const listar = (t: string, tenantId = montese.tenantId) => http().get(rota(tenantId)).set(auth(t));
  const patch = (t: string, id: string, body: any) => http().patch(`/atuacao/interacoes/${id}`).set(auth(t)).send(body);
  const corpo = (extra: any = {}) => ({ type: 'reuniao', occurred_on: '2031-03-10', summary: 'Resumo da conversa', ...extra });
  const tenants = () => [montese.tenantId, outraMontese.tenantId, comTecnico.tenantId];
  const conta = async () =>
    (await db.client.query('SELECT count(*)::int AS n FROM client_interactions WHERE tenant_id = ANY($1)', [tenants()])).rows[0].n as number;
  const linha = async (id: string) =>
    (
      await db.client.query(
        "SELECT summary, decisions, participants, next_steps, type, agenda_event_id, created_by, tenant_id, to_char(occurred_on,'YYYY-MM-DD') AS occurred_on FROM client_interactions WHERE id = $1",
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    socioA = await db.createUserWithRole('socio', 'Socio Int A');
    socioB = await db.createUserWithRole('socio', 'Socio Int B');
    soLeitura = await db.createUserWithRole('socio', 'Socio Int Leitura');
    semPerm = await db.createUserWithRole('socio', 'Socio Int SemPerm');
    admin = await db.createUserWithRole('admin', 'Admin Int Http');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Int Http');
    montese = await db.createTenantWithUser('Cliente Montese Int Http');
    outraMontese = await db.createTenantWithUser('Outro Montese Int Http');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Int Http');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [comTecnico.tenantId, tec.rows[0].id]);
    const ev = async (tenantId: string) =>
      (await db.client.query(INS_EVT, [tenantId, socioA.userId, socioA.userId, 'Evento Int'])).rows[0].id as string;
    evMontese = await ev(montese.tenantId);
    evOutra = await ev(outraMontese.tenantId);
    for (const u of [socioA, socioB]) {
      await db.grantSocioPermission(u.userId, 'clients.read');
      await db.grantSocioPermission(u.userId, 'clients.update_operational');
    }
    await db.grantSocioPermission(soLeitura.userId, 'clients.read');
    await db.grantSocioPermission(semPerm.userId, 'tasks.read');
    tA = await login(socioA.email, socioA.password);
    tB = await login(socioB.email, socioB.password);
    tLeit = await login(soLeitura.email, soLeitura.password);
    tSem = await login(semPerm.email, semPerm.password);
  });

  afterAll(async () => {
    const ids = [socioA, socioB, soLeitura, semPerm].map((u) => u.userId);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [ids]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria com created_by do JWT, aceita data futura e vincula evento do mesmo tenant; dado no banco correto', async () => {
    const r = await criar(
      tA,
      corpo({ participants: 'Ana, Beto', decisions: 'Fechar PGR', next_steps: 'Enviar proposta', agenda_event_id: evMontese, summary: '  Conversa  ' }),
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      tenant_id: montese.tenantId, type: 'reuniao', occurred_on: '2031-03-10', participants: 'Ana, Beto', summary: 'Conversa',
      decisions: 'Fechar PGR', next_steps: 'Enviar proposta', agenda_event_id: evMontese, created_by: socioA.userId,
      created_by_name: 'Socio Int A', editavel: true,
    });
    expect(await linha(r.body.id)).toMatchObject({ created_by: socioA.userId, tenant_id: montese.tenantId, summary: 'Conversa', occurred_on: '2031-03-10' });
  });

  it('tenant de técnico => 404 (GET e POST) e nada criado; agenda_event_id de outro tenant => 400', async () => {
    const antes = await conta();
    expect((await criar(tA, corpo(), comTecnico.tenantId)).status).toBe(404);
    expect((await listar(tA, comTecnico.tenantId)).status).toBe(404);
    expect((await criar(tA, corpo({ agenda_event_id: evOutra }))).status).toBe(400);
    expect(await conta()).toBe(antes);
  });

  it('validação: created_by/tenant_id no corpo, summary vazio/espaços/longo, data inválida, tipo inválido, ids ruins => 400', async () => {
    const antes = await conta();
    const invalidos = [
      corpo({ created_by: socioB.userId }), corpo({ tenant_id: comTecnico.tenantId }), corpo({ summary: '' }), corpo({ summary: '   ' }),
      corpo({ summary: 'a'.repeat(4001) }), corpo({ occurred_on: '2031-02-30' }), corpo({ occurred_on: '10/03/2031' }),
      corpo({ type: 'festa' }), corpo({ agenda_event_id: 'nao-uuid' }), { type: 'reuniao', summary: 'x' },
    ];
    for (const b of invalidos) expect((await criar(tA, b)).status).toBe(400);
    expect((await http().post('/atuacao/clientes/nao-uuid/interacoes').set(auth(tA)).send(corpo())).status).toBe(400);
    expect(await conta()).toBe(antes);
    const limite = await criar(tA, corpo({ summary: 'a'.repeat(4000) }));
    expect(limite.status).toBe(201);
  });

  it('PATCH próprio altera só os campos enviados; null, created_by, tenant_id => 400 e dado intacto', async () => {
    const c = await criar(tA, corpo({ participants: 'P', decisions: 'D', next_steps: 'N', summary: 'Original' }));
    const id = c.body.id;
    const r = await patch(tA, id, { summary: 'Editado', occurred_on: '2031-04-01' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ summary: 'Editado', occurred_on: '2031-04-01', decisions: 'D', participants: 'P', editavel: true });
    expect(await linha(id)).toMatchObject({ summary: 'Editado', occurred_on: '2031-04-01', decisions: 'D', participants: 'P', next_steps: 'N', created_by: socioA.userId });

    for (const campo of ['type', 'occurred_on', 'summary', 'participants', 'decisions', 'next_steps', 'agenda_event_id']) {
      expect((await patch(tA, id, { [campo]: null })).status).toBe(400);
    }
    expect((await patch(tA, id, { summary: '   ' })).status).toBe(400);
    expect((await patch(tA, id, { created_by: socioB.userId })).status).toBe(400);
    expect((await patch(tA, id, { tenant_id: comTecnico.tenantId })).status).toBe(400);
    expect((await patch(tA, id, { agenda_event_id: evOutra })).status).toBe(400);
    expect((await patch(tA, 'nao-uuid', { summary: 'x' })).status).toBe(400);
    expect(await linha(id)).toMatchObject({ summary: 'Editado', created_by: socioA.userId, tenant_id: montese.tenantId, agenda_event_id: null });

    const v = await patch(tA, id, { agenda_event_id: evMontese });
    expect(v.status).toBe(200);
    expect((await linha(id)).agenda_event_id).toBe(evMontese);
  });

  it('PATCH da interação de OUTRO sócio => 404 e dado intacto (inclusive corpo vazio)', async () => {
    const c = await criar(tA, corpo({ summary: 'Do sócio A', decisions: 'Intacto' }));
    const id = c.body.id;
    const antes = await linha(id);
    expect((await patch(tB, id, { summary: 'Invadido', decisions: 'X' })).status).toBe(404);
    expect((await patch(tB, id, {})).status).toBe(404);
    expect((await patch(tB, '00000000-0000-4000-8000-000000000000', { summary: 'x' })).status).toBe(404);
    expect(await linha(id)).toEqual(antes);
    const aud = await db.client.query("SELECT 1 FROM audit_log WHERE resource_id = $1 AND actor_user_id = $2 AND action LIKE 'client.interaction_%'", [id, socioB.userId]);
    expect(aud.rowCount).toBe(0);
  });

  it('GET devolve editavel correto para cada sócio, ordenado e limitado a 200', async () => {
    const a = (await criar(tA, corpo({ summary: 'Lista A', occurred_on: '2032-05-01' }), outraMontese.tenantId)).body.id;
    const b = (await criar(tB, corpo({ summary: 'Lista B', occurred_on: '2032-05-01' }), outraMontese.tenantId)).body.id;
    const velho = (await criar(tB, corpo({ summary: 'Lista velha', occurred_on: '2032-01-01' }), outraMontese.tenantId)).body.id;
    const ra = await listar(tA, outraMontese.tenantId);
    const rb = await listar(tB, outraMontese.tenantId);
    expect(ra.status).toBe(200);
    expect(ra.body.map((x: any) => x.id)).toEqual([b, a, velho]); // occurred_on DESC, created_at DESC
    expect(ra.body.map((x: any) => x.editavel)).toEqual([false, true, false]);
    expect(rb.body.map((x: any) => x.editavel)).toEqual([true, false, true]);
    expect(ra.body[0].created_by_name).toBe('Socio Int B');
    expect((await listar(tLeit, outraMontese.tenantId)).body.map((x: any) => x.editavel)).toEqual([false, false, false]);

    await db.client.query(
      `INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, summary)
       SELECT $1, $2, 'outro', '2020-01-01', 'massa ' || g FROM generate_series(1, 205) g`,
      [outraMontese.tenantId, socioA.userId],
    );
    const lim = await listar(tA, outraMontese.tenantId);
    expect(lim.body.length).toBe(200);
    expect(lim.body[0].id).toBe(b);
  });

  it('permissões: só leitura lê mas não cria/edita; sem permissão => 403 em tudo; nada criado', async () => {
    const c = await criar(tA, corpo({ summary: 'Perm' }));
    const antes = await conta();
    expect((await listar(tLeit)).status).toBe(200);
    expect((await criar(tLeit, corpo())).status).toBe(403);
    expect((await patch(tLeit, c.body.id, { summary: 'x' })).status).toBe(403);
    expect((await listar(tSem)).status).toBe(403);
    expect((await criar(tSem, corpo())).status).toBe(403);
    expect((await patch(tSem, c.body.id, { summary: 'x' })).status).toBe(403);
    expect(await conta()).toBe(antes);
    expect((await linha(c.body.id)).summary).toBe('Perm');
  });

  it('empresa, técnico e admin => 403 em /atuacao/*/interacoes', async () => {
    const tokens = [
      await login(montese.email, montese.password),
      await login(tecnicoUser.email, tecnicoUser.password),
      await login(admin.email, admin.password),
    ];
    const c = await criar(tA, corpo({ summary: 'Fechada' }));
    const antes = await conta();
    for (const t of tokens) {
      expect((await listar(t)).status).toBe(403);
      expect((await criar(t, corpo())).status).toBe(403);
      expect((await patch(t, c.body.id, { summary: 'x' })).status).toBe(403);
    }
    expect(await conta()).toBe(antes);
    expect((await linha(c.body.id)).summary).toBe('Fechada');
  });

  it('rotas não colidem: GET /atuacao/clientes/:tenantId continua servindo o detalhe do cliente', async () => {
    const r = await http().get(`/atuacao/clientes/${montese.tenantId}`).set(auth(tA));
    expect(r.status).toBe(200);
  });

  it('auditoria client.interaction_created/updated: só ids e nomes de campo, status coerente, sem texto livre', async () => {
    const segredo = 'ResumoSecretoInt123';
    const dec = 'DecisaoSecretaInt456';
    const part = 'ParticipanteSecretoInt789';
    const c = await criar(tA, corpo({ summary: segredo, decisions: dec, participants: part }));
    const id = c.body.id;
    await patch(tA, id, { summary: `${segredo}2`, next_steps: dec });
    await patch(tB, id, { summary: 'negado' }); // 404: sem auditoria de sucesso
    const q = await db.client.query(
      "SELECT action, detail, actor_user_id, status_code, resource_type FROM audit_log WHERE resource_id = $1 AND action LIKE 'client.interaction_%' ORDER BY occurred_at",
      [id],
    );
    expect(q.rows.map((x: any) => x.action)).toEqual(['client.interaction_created', 'client.interaction_updated']);
    expect(q.rows.map((x: any) => x.status_code)).toEqual([201, 200]);
    expect(q.rows.every((x: any) => x.actor_user_id === socioA.userId && x.resource_type === 'client_interaction')).toBe(true);
    expect(q.rows[1].detail).toContain('summary');
    expect(q.rows[1].detail).toContain('next_steps');
    for (const row of q.rows) expect(JSON.stringify(row)).not.toContain('Secret');
    await semTextoLivreNaAuditoria([socioA.userId, socioB.userId], ['ResumoSecreto', 'DecisaoSecreta', 'ParticipanteSecreto']);
  });

  it('auditoria: path das linhas client.interaction_* não tem query string', async () => {
    const c = await criar(tA, corpo());
    const r = await http().patch(`/atuacao/interacoes/${c.body.id}?ref=QueryLivreInt`).set(auth(tA)).send({ summary: 'Outro resumo' });
    expect(r.status).toBe(200);
    const q = await db.client.query("SELECT path FROM audit_log WHERE resource_id = $1 AND action LIKE 'client.interaction_%'", [c.body.id]);
    expect(q.rows.length).toBe(2);
    for (const row of q.rows) expect(row.path).not.toContain('?');
    expect(q.rows.map((x: any) => x.path)).toContain(`/atuacao/interacoes/${c.body.id}`);
  });
});
