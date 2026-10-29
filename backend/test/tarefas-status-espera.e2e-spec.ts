import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// D2 Task 1: migration 0100 amplia tasks.status com 3 estados de espera. Nível banco, role da aplicação
// (montese_app, sujeita a RLS), transação com set_config local, sempre com ROLLBACK.
const NOVOS = ['awaiting_client', 'awaiting_execution', 'awaiting_efficacy'] as const;
const ANTIGOS = ['pending', 'in_progress', 'blocked', 'awaiting_review', 'completed', 'cancelled'] as const;

async function comoSocio<T>(userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'socio', true)",
      [userId],
    );
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

describe('tarefas-status-espera — migration 0100 (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let montese: { tenantId: string };
  let parceiro: { tenantId: string };

  const inserir = (c: Client, tenantId: string, status: string, due: string | null = null) =>
    c.query(
      `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, status, due_date)
       VALUES ($1, 'Tarefa espera', $2, $2, $3, $4) RETURNING id`,
      [tenantId, socio.userId, status, due],
    );

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Espera');
    montese = await db.createTenantWithUser('Cliente Montese Espera');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Espera');
    const tecnico = await db.createUserWithRole('tecnico', 'Tec Espera');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
  });

  it.each([...NOVOS])('socio insere tarefa com status %s na carteira Montese', async (st) => {
    const r = await comoSocio(socio.userId, (c) => inserir(c, montese.tenantId, st));
    expect(r.rowCount).toBe(1);
  });

  it.each([...NOVOS])('socio atualiza tarefa existente para %s', async (st) => {
    const status = await comoSocio(socio.userId, async (c) => {
      const id = (await inserir(c, montese.tenantId, 'pending')).rows[0].id;
      const u = await c.query('UPDATE tasks SET status = $2 WHERE id = $1 RETURNING status', [id, st]);
      return u.rows[0].status;
    });
    expect(status).toBe(st);
  });

  it.each([...ANTIGOS])('status antigo %s continua aceito', async (st) => {
    const r = await comoSocio(socio.userId, (c) => inserir(c, montese.tenantId, st));
    expect(r.rowCount).toBe(1);
  });

  it('status fora da lista é rejeitado (insert e update) pelo CHECK', async () => {
    await expect(comoSocio(socio.userId, (c) => inserir(c, montese.tenantId, 'awaiting_nothing'))).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      comoSocio(socio.userId, async (c) => {
        const id = (await inserir(c, montese.tenantId, 'pending')).rows[0].id;
        await c.query("UPDATE tasks SET status = 'Awaiting_Client' WHERE id = $1", [id]);
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('task_events aceita status_changed com os novos valores', async () => {
    const r = await comoSocio(socio.userId, async (c) => {
      const id = (await inserir(c, montese.tenantId, 'pending')).rows[0].id;
      return c.query(
        `INSERT INTO task_events (task_id, tenant_id, actor_user_id, type, from_value, to_value)
         VALUES ($1, $2, $3, 'status_changed', 'pending', 'awaiting_client')`,
        [id, montese.tenantId, socio.userId],
      );
    });
    expect(r.rowCount).toBe(1);
  });

  it('empresa de parceiro continua não gravável pelo socio (RLS inalterada)', async () => {
    for (const st of NOVOS) {
      await expect(comoSocio(socio.userId, (c) => inserir(c, parceiro.tenantId, st))).rejects.toMatchObject({
        code: '42501',
      });
    }
    // Insert pelo superusuário de teste em tenant de parceiro: socio não enxerga nem atualiza.
    const t = await db.client.query(
      `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, status)
       VALUES ($1, 'Parceiro', $2, $2, 'pending') RETURNING id`,
      [parceiro.tenantId, socio.userId],
    );
    const { sel, upd } = await comoSocio(socio.userId, async (c) => ({
      sel: (await c.query('SELECT id FROM tasks WHERE id = $1', [t.rows[0].id])).rowCount,
      upd: (await c.query("UPDATE tasks SET status = 'awaiting_client' WHERE id = $1", [t.rows[0].id])).rowCount,
    }));
    expect(sel).toBe(0);
    expect(upd).toBe(0);
  });

  it('índice parcial tasks_due_idx segue excluindo completed/cancelled e inclui os novos status', async () => {
    const def = (await db.client.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'tasks_due_idx'")).rows[0]
      .indexdef as string;
    expect(def).toMatch(/completed/);
    expect(def).toMatch(/cancelled/);
    for (const n of NOVOS) expect(def).not.toContain(n);

    const abertas = await comoSocio(socio.userId, async (c) => {
      const ids: Record<string, string> = {};
      for (const st of [...ANTIGOS, ...NOVOS]) ids[st] = (await inserir(c, montese.tenantId, st, '2031-01-01')).rows[0].id;
      const r = await c.query(
        `SELECT status FROM tasks WHERE tenant_id = $1 AND due_date = '2031-01-01' AND status NOT IN ('completed','cancelled')`,
        [montese.tenantId],
      );
      return r.rows.map((x: any) => x.status as string).sort();
    });
    expect(abertas).toEqual(['pending', 'in_progress', 'blocked', 'awaiting_review', ...NOVOS].sort());
  });

  it('cabeçalho da migration documenta rollback sem perda de tarefas', () => {
    const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0100_tarefas_status_espera.sql'), 'utf8');
    const cabecalho = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
    expect(cabecalho).toMatch(/ROLLBACK/i);
    expect(cabecalho).toMatch(/UPDATE tasks SET status = 'blocked' WHERE status IN \('awaiting_client', 'awaiting_execution', 'awaiting_efficacy'\)/);
    expect(cabecalho).toMatch(/DROP CONSTRAINT tasks_status_check/);
    expect(cabecalho).toMatch(/ADD CONSTRAINT tasks_status_check CHECK \(status IN \('pending','in_progress','blocked','awaiting_review','completed','cancelled'\)\)/);
    expect(cabecalho).toMatch(/task_events/);
    expect(cabecalho).toMatch(/DELETE FROM _migrations WHERE name = '0100_tarefas_status_espera\.sql'/);
  });
});
