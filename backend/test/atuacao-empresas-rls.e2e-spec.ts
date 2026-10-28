import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// Atuação por empresa (Z), Task 1: RLS do papel socio sobre dados da empresa
// (employees, positions, EPI) e UPDATE restrito à vigência em documents.
// Conexão na role da aplicação (sujeita a RLS), transação local, sempre ROLLBACK.
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

describe('atuacao-empresas — RLS do socio (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let montese: { tenantId: string; userId: string; employeeId: string };
  let parceiro: { tenantId: string; userId: string; employeeId: string };
  let docMontese: string;
  let docParceiro: string;
  let docCadastro: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Empresas RLS');
    montese = await db.createTenantWithUser('Cliente Montese Emp');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Emp');

    // parceiro = tenant com vínculo a técnico (fora da carteira Montese)
    const tecnico = await db.createUserWithRole('tecnico', 'Tec Emp RLS');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);

    for (const t of [montese, parceiro]) {
      await db.insertRawRow('positions', { tenant_id: t.tenantId, name: 'Cargo RLS' });
      const cat = await db.client.query('SELECT id FROM epi_catalog_items LIMIT 1');
      const epi = await db.insertRawRow('tenant_epis', {
        tenant_id: t.tenantId,
        epi_catalog_item_id: cat.rows[0].id,
        ca_number: '12345',
        created_by_user_id: t.userId,
      });
      await db.insertRawRow('employee_epi_deliveries', {
        tenant_id: t.tenantId,
        tenant_epi_id: epi,
        employee_id: t.employeeId,
        delivered_at: '2026-01-10',
        signed_by_name: 'Func RLS',
        created_by_user_id: t.userId,
      });
    }

    const mkDoc = (t: { tenantId: string; userId: string }, category: string) =>
      db.insertRawRow('documents', {
        tenant_id: t.tenantId,
        category,
        title: `Doc ${category}`,
        file_key: `rls/${Math.random()}`,
        file_name: 'a.pdf',
        mime_type: 'application/pdf',
        size_bytes: 10,
        uploaded_by_user_id: t.userId,
        uploaded_by_role: 'empresa',
      });
    docMontese = await mkDoc(montese, 'pgr');
    docParceiro = await mkDoc(parceiro, 'pgr');
    docCadastro = await mkDoc(montese, 'cadastro_funcionarios');
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
  });

  const contar = (tabela: string, tenantId: string) =>
    comoSocio(socio.userId, async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE tenant_id = $1`, [tenantId])).rows[0].n as number,
    );

  it.each(['employees', 'positions', 'tenant_epis'])(
    'socio lê %s do cliente Montese',
    async (t) => {
      expect(await contar(t, montese.tenantId)).toBe(1);
    },
  );

  it('socio NÃO lê employee_epi_deliveries (nenhuma rota usa; mínimo privilégio), nem do cliente Montese', async () => {
    expect(await contar('employee_epi_deliveries', montese.tenantId)).toBe(0);
    expect(await contar('employee_epi_deliveries', parceiro.tenantId)).toBe(0);
    const pol = await db.client.query("SELECT 1 FROM pg_policies WHERE tablename = 'employee_epi_deliveries' AND policyname = 'employee_epi_deliveries_socio_select'");
    expect(pol.rowCount).toBe(0);
  });

  it('documents: conjunto exato de triggers BEFORE UPDATE (novo trigger pode contornar trg_b_guard_documents_socio_update: revisar)', async () => {
    const r = await db.client.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'documents'::regclass AND NOT tgisinternal
          AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 ORDER BY tgname`,
    );
    expect(r.rows.map((x: any) => x.tgname)).toEqual(['trg_b_guard_documents_socio_update', 'trg_documents_updated_at']);
  });

  it.each(['employees', 'positions', 'tenant_epis', 'employee_epi_deliveries'])(
    'socio NÃO lê %s de empresa de parceiro',
    async (t) => {
      expect(await contar(t, parceiro.tenantId)).toBe(0);
    },
  );

  it.each(['employees', 'positions', 'tenant_epis', 'employee_epi_deliveries'])('socio não escreve em %s', async (t) => {
    await comoSocio(socio.userId, async (c) => {
      const upd = await c.query(`UPDATE ${t} SET tenant_id = tenant_id WHERE tenant_id = $1`, [montese.tenantId]);
      expect(upd.rowCount).toBe(0);
      const del = await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [montese.tenantId]);
      expect(del.rowCount).toBe(0);
    });
    const ainda = await db.client.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [montese.tenantId]);
    expect(ainda.rows[0].n).toBe(1);
  });

  it('socio não insere em employees', async () => {
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query(
          "INSERT INTO employees (tenant_id, full_name, cpf) VALUES ($1, 'Intruso', '00000000191')",
          [montese.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('socio altera só a vigência de documents', async () => {
    // Sucesso: lê de volta DENTRO da mesma transação (o ROLLBACK depois desfaz).
    const lido = await comoSocio(socio.userId, async (c) => {
      const ok = await c.query(
        "UPDATE documents SET expires_at = '2030-01-01', expires_source = 'manual' WHERE id = $1",
        [docMontese],
      );
      expect(ok.rowCount).toBe(1);
      return (await c.query('SELECT expires_at::text AS e, expires_source FROM documents WHERE id = $1', [docMontese])).rows[0];
    });
    expect(lido).toEqual({ e: '2030-01-01', expires_source: 'manual' });

    // Colunas proibidas: cada UPDATE falha com a mensagem do trigger de vigência.
    const proibidas: [string, string, any[]][] = [
      ['title', "title = 'x'", []],
      ['category', "category = 'laudo'", []],
      ['file_key', "file_key = 'outra/chave'", []],
      ['uploaded_by_role', "uploaded_by_role = 'admin'", []],
    ];
    for (const [, set] of proibidas) {
      await comoSocio(socio.userId, async (c) => {
        await expect(c.query(`UPDATE documents SET ${set} WHERE id = $1`, [docMontese])).rejects.toThrow(/vigência/);
      });
    }
    // Mudar tenant_id: barrado pelo trigger de vigência ou pela RLS (WITH CHECK).
    await comoSocio(socio.userId, async (c) => {
      await expect(
        c.query('UPDATE documents SET tenant_id = $2 WHERE id = $1', [docMontese, parceiro.tenantId]),
      ).rejects.toThrow(/vigência|row-level security/i);
    });
    // DELETE: 0 linhas, verificado na própria transação.
    await comoSocio(socio.userId, async (c) => {
      const del = await c.query('DELETE FROM documents WHERE id = $1', [docMontese]);
      expect(del.rowCount).toBe(0);
      const ainda = await c.query('SELECT count(*)::int AS n FROM documents WHERE id = $1', [docMontese]);
      expect(ainda.rows[0].n).toBe(1);
    });
    // Estado persistido (fora da transação do sócio) permanece intacto.
    const d = await db.client.query('SELECT title, category, expires_at FROM documents WHERE id = $1', [docMontese]);
    expect(d.rows[0].title).toBe('Doc pgr');
    expect(d.rows[0].category).toBe('pgr');
    expect(d.rows[0].expires_at).toBeNull();
  });

  it('socio não vê documento da categoria cadastro_funcionarios (restritiva 0083)', async () => {
    const n = await comoSocio(socio.userId, async (c) =>
      (await c.query('SELECT count(*)::int AS n FROM documents WHERE id = $1', [docCadastro])).rows[0].n,
    );
    expect(n).toBe(0);
    const upd = await comoSocio(socio.userId, (c) =>
      c.query("UPDATE documents SET expires_at = '2030-01-01' WHERE id = $1", [docCadastro]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('socio não atualiza documento de empresa de parceiro', async () => {
    const upd = await comoSocio(socio.userId, (c) =>
      c.query("UPDATE documents SET expires_at = '2030-01-01' WHERE id = $1", [docParceiro]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('CHECK aceita empresas.read e empresas.documentos', async () => {
    await db.grantSocioPermission(socio.userId, 'empresas.read');
    await db.grantSocioPermission(socio.userId, 'empresas.documentos');
    const r = await db.client.query(
      "SELECT count(*)::int AS n FROM socio_permissions WHERE user_id = $1 AND permission IN ('empresas.read','empresas.documentos')",
      [socio.userId],
    );
    expect(r.rows[0].n).toBe(2);
  });
});
