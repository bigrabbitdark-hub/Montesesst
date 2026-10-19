import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('Schema de epi_ficha_documents (0082)', () => {
  let db: TestDb;
  let sql: Client;
  let app: Client;
  let tenantId: string;
  let userId: string;
  let employeeId: string;
  let otherTenantId: string;
  let otherEmployeeId: string;

  const insertDoc = (over: Record<string, unknown> = {}) =>
    sql.query(
      `INSERT INTO epi_ficha_documents
         (tenant_id, employee_id, version, document_code, file_key, file_sha256, snapshot_sha256, snapshot,
          term_version, issued_by_user_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,'rascunho-1',$8,$9) RETURNING id`,
      [
        over.tenant ?? tenantId, over.employee ?? employeeId, over.version ?? 1,
        over.code ?? `FEPI-T-${randomUUID().slice(0, 6)}`, 'k/arquivo.pdf', over.fileHash ?? HASH_A,
        over.snapHash ?? HASH_B, userId, over.key ?? `idem-${randomUUID()}`,
      ],
    );

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const a = await db.createTenantWithUser('Empresa Ficha Schema A');
    const b = await db.createTenantWithUser('Empresa Ficha Schema B');
    tenantId = a.tenantId; userId = a.userId; employeeId = a.employeeId;
    otherTenantId = b.tenantId; otherEmployeeId = b.employeeId;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end(); await app.end();
    await db.disconnect();
  });

  it('employees ganha registration_number e department (nulos por padrão)', async () => {
    const r = await sql.query('SELECT registration_number, department FROM employees WHERE id = $1', [employeeId]);
    expect(r.rows[0]).toEqual({ registration_number: null, department: null });
  });

  it('employees limita o setor (120) no banco', async () => {
    await expect(sql.query('UPDATE employees SET department = $2 WHERE id = $1', [employeeId, 'y'.repeat(121)]))
      .rejects.toMatchObject({ code: '23514', constraint: 'chk_employees_department_len' });
  });

  it('rejeita hash que não é hex de 64 e versão < 1', async () => {
    await expect(insertDoc({ fileHash: 'xyz' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertDoc({ version: 0 })).rejects.toMatchObject({ code: '23514' });
  });

  it('versão, código e idempotency_key são únicos por empresa', async () => {
    await insertDoc({ version: 1, code: 'FEPI-U-0001', key: 'idem-u-1' });
    await expect(insertDoc({ version: 1, code: 'FEPI-U-0002', key: 'idem-u-2' })).rejects.toMatchObject({ code: '23505' });
    await expect(insertDoc({ version: 2, code: 'FEPI-U-0001', key: 'idem-u-3' })).rejects.toMatchObject({ code: '23505' });
    await expect(insertDoc({ version: 2, code: 'FEPI-U-0004', key: 'idem-u-1' })).rejects.toMatchObject({ code: '23505' });
  });

  it('é imutável: UPDATE e DELETE diretos falham com 42501', async () => {
    const { rows } = await insertDoc({ version: 7, code: 'FEPI-I-0001', key: 'idem-i-1' });
    await expect(sql.query(`UPDATE epi_ficha_documents SET file_sha256 = $2 WHERE id = $1`, [rows[0].id, HASH_B])).rejects.toMatchObject({ code: '42501' });
    await expect(sql.query('DELETE FROM epi_ficha_documents WHERE id = $1', [rows[0].id])).rejects.toMatchObject({ code: '42501' });
  });

  it('TRUNCATE é negado à role da aplicação', async () => {
    await expect(app.query('TRUNCATE epi_ficha_documents')).rejects.toMatchObject({ code: '42501' });
  });

  it('RLS: a empresa B não vê nem insere documentos da A', async () => {
    await insertDoc({ version: 20, code: 'FEPI-R-0001', key: 'idem-r-1' });
    const asTenant = async (tid: string, fn: (c: Client) => Promise<void>) => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.role','empresa',true), set_config('app.tenant_id',$1,true)`, [tid]);
        await fn(app);
      } finally {
        await app.query('ROLLBACK');
      }
    };
    await asTenant(otherTenantId, async (c) => {
      const r = await c.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [tenantId]);
      expect(r.rowCount).toBe(0);
      await expect(
        c.query(
          `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
             snapshot_sha256, snapshot, term_version, issued_by_user_id, idempotency_key)
           VALUES ($1,$2,1,'FEPI-X-1','k',$3,$3,'{}','t',$4,'idem-x-1')`,
          [tenantId, employeeId, HASH_A, userId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await asTenant(tenantId, async (c) => {
      const r = await c.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [tenantId]);
      expect(r.rowCount).toBeGreaterThan(0);
    });
    expect(otherEmployeeId).toBeTruthy();
  });

  it('exclusão do tenant cascateia mesmo com documentos emitidos', async () => {
    const c = await db.createTenantWithUser('Empresa Ficha Cascade');
    await sql.query(
      `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
         snapshot_sha256, snapshot, term_version, issued_by_user_id, idempotency_key)
       VALUES ($1,$2,1,'FEPI-C-0001','k',$3,$3,'{}','t',$4,'idem-c-1')`,
      [c.tenantId, c.employeeId, HASH_A, c.userId],
    );
    await sql.query('DELETE FROM tenants WHERE id = $1', [c.tenantId]);
    const left = await sql.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [c.tenantId]);
    expect(left.rowCount).toBe(0);
  });
});
