import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Schema do livro de EPI (0081)', () => {
  let db: TestDb;
  let sql: Client;
  let tenantId: string;
  let userId: string;
  let epiId: string;
  let employeeId: string;
  let catalogId: string;
  let tenantB: { tenantId: string; userId: string };
  let movAId: string;
  let lotAId: string;

  // Erros do pg expõem code/constraint; asserções específicas evitam falso positivo.
  const CHECK = '23514';
  const UNIQUE = '23505';
  const TRIGGER_DENIED = '42501';

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Schema');
    tenantId = t.tenantId;
    userId = t.userId;
    employeeId = t.employeeId;
    const cat = await sql.query('SELECT id FROM epi_catalog_items ORDER BY id LIMIT 1');
    catalogId = cat.rows[0].id;
    const epi = await sql.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
       VALUES ($1, $2, 'CA-SCHEMA-1', $3) RETURNING id`,
      [tenantId, cat.rows[0].id, userId],
    );
    epiId = epi.rows[0].id;
    tenantB = await db.createTenantWithUser('Empresa Epi Schema B');

    const lot = await sql.query(
      `INSERT INTO epi_lots (tenant_id, tenant_epi_id, lot_code, balance) VALUES ($1, $2, 'L-A', 1) RETURNING id`,
      [tenantId, epiId],
    );
    lotAId = lot.rows[0].id;
    const mov = await insertMovement({ key: 'rls-a-1' });
    movAId = mov.rows[0].id;

    // objetos auxiliares do teste negativo do trigger (removidos no afterAll)
    await sql.query('CREATE TABLE epi_probe_aux (id INT PRIMARY KEY)');
    await sql.query(`CREATE FUNCTION epi_probe_aux_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM epi_movements WHERE id = '${movAId}'; RETURN OLD; END; $$`);
    await sql.query(`CREATE TRIGGER epi_probe_aux_trg BEFORE DELETE ON epi_probe_aux
      FOR EACH ROW EXECUTE FUNCTION epi_probe_aux_fn()`);
  });

  afterAll(async () => {
    await sql.query('DROP TABLE IF EXISTS epi_probe_aux');
    await sql.query('DROP FUNCTION IF EXISTS epi_probe_aux_fn()');
    await db.cleanup(); // DELETE de tenant em CASCADE precisa passar pelo trigger
    await sql.end();
    await db.disconnect();
  });

  const insertMovement = (over: Record<string, unknown> = {}) =>
    sql.query(
      `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after,
                                  supplier, reason, employee_id, reverses_movement_id, idempotency_key, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'teste', $8, $9, $10, $11) RETURNING id`,
      [
        over.tenant ?? tenantId, over.epi ?? epiId, over.type ?? 'entrada', over.direction ?? 1, over.quantity ?? 5,
        over.balance_after ?? 5, 'supplier' in over ? over.supplier : 'Fornecedor X',
        over.employee ?? null, over.reverses ?? null, over.key ?? `k-${Math.random()}`, over.user ?? userId,
      ],
    );

  it('rejeita quantidade <= 0 e saldo negativo no EPI', async () => {
    await expect(insertMovement({ quantity: 0 })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'epi_movements_quantity_check',
    });
    await expect(sql.query('UPDATE tenant_epis SET stock_balance = -1 WHERE id = $1', [epiId])).rejects.toMatchObject({
      code: CHECK,
      constraint: 'tenant_epis_stock_balance_check',
    });
  });

  it('bloqueia UPDATE e DELETE direto em epi_movements', async () => {
    const { rows } = await insertMovement();
    await expect(sql.query('UPDATE epi_movements SET quantity = 9 WHERE id = $1', [rows[0].id])).rejects.toMatchObject({
      code: TRIGGER_DENIED,
      message: expect.stringMatching(/imut/i),
    });
    await expect(sql.query('DELETE FROM epi_movements WHERE id = $1', [rows[0].id])).rejects.toMatchObject({
      code: TRIGGER_DENIED,
      message: expect.stringMatching(/imut/i),
    });
  });

  it('impede a mesma idempotency_key duas vezes na mesma empresa', async () => {
    await insertMovement({ key: 'chave-unica-1' });
    await expect(insertMovement({ key: 'chave-unica-1' })).rejects.toMatchObject({
      code: UNIQUE,
      constraint: 'epi_movements_tenant_id_idempotency_key_key',
    });
  });

  it('exige reason em baixa e ajuste', async () => {
    await expect(
      sql.query(
        `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after,
                                    idempotency_key, created_by_user_id)
         VALUES ($1, $2, 'baixa', -1, 1, 0, 'k-baixa-sem-motivo', $3)`,
        [tenantId, epiId, userId],
      ),
    ).rejects.toMatchObject({ code: CHECK, constraint: 'chk_epi_mov_reason' });
  });

  it('entrada exige origem (supplier)', async () => {
    await expect(insertMovement({ supplier: null })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'chk_epi_mov_supplier',
    });
    await expect(insertMovement({ supplier: '   ' })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'chk_epi_mov_supplier',
    });
  });

  it('impede duas unicidades iguais de EPI (catálogo+CA+fabricante+modelo) na mesma empresa', async () => {
    await expect(
      sql.query(
        `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
         VALUES ($1, $2, 'CA-SCHEMA-1', $3)`,
        [tenantId, catalogId, userId],
      ),
    ).rejects.toMatchObject({ code: UNIQUE, constraint: 'uq_tenant_epis_identity' });
  });

  it.each(['entrega', 'troca', 'devolucao'])('%s sem employee_id é rejeitada', async (type) => {
    await expect(insertMovement({ type, direction: type === 'devolucao' ? 1 : -1 })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'chk_epi_mov_employee',
    });
    // com employee_id passa
    await expect(
      insertMovement({ type, direction: type === 'devolucao' ? 1 : -1, employee: employeeId }),
    ).resolves.toBeDefined();
  });

  it('estorno exige reverses_movement_id e só estorno pode tê-lo', async () => {
    await expect(insertMovement({ type: 'estorno', direction: -1 })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'chk_epi_mov_reverses',
    });
    await expect(insertMovement({ type: 'entrada', reverses: movAId })).rejects.toMatchObject({
      code: CHECK,
      constraint: 'chk_epi_mov_reverses',
    });
  });

  it('segundo estorno da mesma movimentação é rejeitado', async () => {
    const orig = await insertMovement({ key: 'orig-estorno' });
    await insertMovement({ type: 'estorno', direction: -1, reverses: orig.rows[0].id, balance_after: 0 });
    await expect(
      insertMovement({ type: 'estorno', direction: -1, reverses: orig.rows[0].id, balance_after: 0 }),
    ).rejects.toMatchObject({ code: UNIQUE, constraint: 'uq_epi_movements_reverses' });
  });

  it('DELETE feito por dentro de outro trigger continua bloqueado (tenant existe)', async () => {
    await sql.query('INSERT INTO epi_probe_aux (id) VALUES (1)');
    await expect(sql.query('DELETE FROM epi_probe_aux WHERE id = 1')).rejects.toMatchObject({
      code: TRIGGER_DENIED,
      message: expect.stringMatching(/imut/i),
    });
    const { rowCount } = await sql.query('SELECT 1 FROM epi_movements WHERE id = $1', [movAId]);
    expect(rowCount).toBe(1);
  });

  it('DELETE de tenant com movimentos e lotes cascateia e deixa 0 linhas', async () => {
    const c = await db.createTenantWithUser('Empresa Epi Schema C');
    const epi = await sql.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
       VALUES ($1, $2, 'CA-SCHEMA-C', $3) RETURNING id`,
      [c.tenantId, catalogId, c.userId],
    );
    await sql.query(
      `INSERT INTO epi_lots (tenant_id, tenant_epi_id, lot_code) VALUES ($1, $2, 'L-C')`,
      [c.tenantId, epi.rows[0].id],
    );
    await insertMovement({ tenant: c.tenantId, epi: epi.rows[0].id, user: c.userId });
    // Entrega com funcionário e delivery_id (FKs RESTRICT) também não pode impedir o cascade.
    const del = await sql.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, created_by_user_id)
       VALUES ($1, $2, $3, CURRENT_DATE, 1, 'pendente', $4) RETURNING id`,
      [c.tenantId, epi.rows[0].id, c.employeeId, c.userId],
    );
    await sql.query(
      `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, employee_id,
                                  delivery_id, idempotency_key, created_by_user_id)
       VALUES ($1, $2, 'entrega', -1, 1, 4, $3, $4, 'cascade-entrega-1', $5)`,
      [c.tenantId, epi.rows[0].id, c.employeeId, del.rows[0].id, c.userId],
    );
    await sql.query('DELETE FROM tenants WHERE id = $1', [c.tenantId]);
    const dl = await sql.query('SELECT 1 FROM employee_epi_deliveries WHERE tenant_id = $1', [c.tenantId]);
    expect(dl.rowCount).toBe(0);
    const mv = await sql.query('SELECT 1 FROM epi_movements WHERE tenant_id = $1', [c.tenantId]);
    const lt = await sql.query('SELECT 1 FROM epi_lots WHERE tenant_id = $1', [c.tenantId]);
    expect(mv.rowCount).toBe(0);
    expect(lt.rowCount).toBe(0);
  });

  it('a role da aplicação não consegue TRUNCATE no livro nem nos lotes (42501)', async () => {
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      for (const t of ['epi_movements', 'epi_lots']) {
        await expect(app.query(`TRUNCATE ${t}`)).rejects.toMatchObject({ code: TRIGGER_DENIED });
      }
    } finally {
      await app.end();
    }
    expect((await sql.query('SELECT 1 FROM epi_movements WHERE id = $1', [movAId])).rowCount).toBe(1);
  });

  describe('RLS com a role da aplicação', () => {
    async function asApp<T>(role: string, ctxTenant: string, fn: (c: Client) => Promise<T>): Promise<T> {
      const app = new Client({ connectionString: process.env.DATABASE_URL });
      await app.connect();
      try {
        await app.query('BEGIN');
        await app.query('SELECT set_config($1, $2, true)', ['app.user_id', randomUUID()]);
        await app.query('SELECT set_config($1, $2, true)', ['app.tenant_id', ctxTenant]);
        await app.query('SELECT set_config($1, $2, true)', ['app.role', role]);
        try {
          return await fn(app);
        } finally {
          await app.query('ROLLBACK');
        }
      } finally {
        await app.end();
      }
    }

    it('tenant A vê as próprias linhas; tenant B não vê as de A', async () => {
      const a = await asApp('empresa', tenantId, async (c) => ({
        mv: (await c.query('SELECT id FROM epi_movements')).rows.map((r) => r.id),
        lt: (await c.query('SELECT id FROM epi_lots')).rows.map((r) => r.id),
      }));
      expect(a.mv).toContain(movAId);
      expect(a.lt).toContain(lotAId);
      const b = await asApp('empresa', tenantB.tenantId, async (c) => ({
        mv: (await c.query('SELECT id FROM epi_movements')).rows.map((r) => r.id),
        lt: (await c.query('SELECT id FROM epi_lots')).rows.map((r) => r.id),
      }));
      expect(b.mv).not.toContain(movAId);
      expect(b.lt).not.toContain(lotAId);
    });

    it('tenant B não consegue inserir nem atualizar linhas do tenant A', async () => {
      await asApp('empresa', tenantB.tenantId, async (c) => {
        await c.query('SAVEPOINT s1');
        await expect(
          c.query(
            `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, supplier, idempotency_key, created_by_user_id)
             VALUES ($1, $2, 'entrada', 1, 1, 1, 'X', 'rls-b-ins', $3)`,
            [tenantId, epiId, tenantB.userId],
          ),
        ).rejects.toMatchObject({ code: TRIGGER_DENIED, message: expect.stringMatching(/row-level security/i) });
        await c.query('ROLLBACK TO s1');
        await expect(
          c.query(`INSERT INTO epi_lots (tenant_id, tenant_epi_id, lot_code) VALUES ($1, $2, 'L-B')`, [tenantId, epiId]),
        ).rejects.toMatchObject({ code: TRIGGER_DENIED, message: expect.stringMatching(/row-level security/i) });
        await c.query('ROLLBACK TO s1');
        const upLot = await c.query('UPDATE epi_lots SET balance = 99 WHERE id = $1', [lotAId]);
        expect(upLot.rowCount).toBe(0);
        // UPDATE em epi_movements: RLS filtra antes do trigger, 0 linhas e sem erro
        const upMov = await c.query('UPDATE epi_movements SET quantity = 9 WHERE id = $1', [movAId]);
        expect(upMov.rowCount).toBe(0);
      });
    });
  });
});
