import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';

// PGR (sub-projeto A), Task 1: RLS e coerência de tenant das tabelas do inventário.
// Conexão na role da aplicação (sujeita a RLS), transação local, sempre ROLLBACK.
async function comoPapel<T>(role: string, userId: string, fn: (c: Client) => Promise<T>, tenantId = ''): Promise<T> {
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

const TABELAS_EMPRESA = ['pgr_ghes', 'pgr_ghe_positions', 'pgr_risks', 'pgr_risk_controls', 'pgr_risk_measurements'];

describe('pgr — RLS e coerência de tenant (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let tecnico: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let montese2: { tenantId: string; userId: string };
  let parceiro: { tenantId: string; userId: string };
  const ids: Record<string, string> = {};
  const criadosGlobais: string[] = [];

  const comoSocio = <T>(fn: (c: Client) => Promise<T>) => comoPapel('socio', socio.userId, fn);

  // Cadeia completa (GHE, cargo, vínculo, risco, controle, medição) de um tenant, via conexão de teste.
  async function cadeia(t: { tenantId: string }, p: string) {
    const ghe = await db.insertRawRow('pgr_ghes', { tenant_id: t.tenantId, name: `TESTE GHE ${p}` });
    const pos = await db.insertRawRow('positions', { tenant_id: t.tenantId, name: `TESTE Cargo ${p}` });
    const vinc = await db.insertRawRow('pgr_ghe_positions', { tenant_id: t.tenantId, ghe_id: ghe, position_id: pos });
    const risk = await db.insertRawRow('pgr_risks', {
      tenant_id: t.tenantId, ghe_id: ghe, category: 'fisico', name: `TESTE Risco ${p}`, exposure_type: 'eventual',
    });
    const ctrl = await db.insertRawRow('pgr_risk_controls', {
      tenant_id: t.tenantId, risk_id: risk, kind: 'epc', status: 'existente', description: 'TESTE controle',
    });
    const med = await db.insertRawRow('pgr_risk_measurements', {
      tenant_id: t.tenantId, risk_id: risk, agent: 'TESTE agente', value: '85', unit: 'dB(A)',
    });
    return { ghe, pos, vinc, risk, ctrl, med };
  }

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio PGR RLS');
    tecnico = await db.createUserWithRole('tecnico', 'Tec PGR RLS');
    montese = await db.createTenantWithUser('Cliente Montese PGR');
    montese2 = await db.createTenantWithUser('Cliente Montese2 PGR');
    parceiro = await db.createTenantWithUser('Cliente Parceiro PGR');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId, tec.rows[0].id,
    ]);

    const g = await db.client.query(
      "INSERT INTO pgr_hazards (scope, category, name) VALUES ('global','fisico','TESTE Ruído global') RETURNING id",
    );
    ids.hGlobal = g.rows[0].id;
    criadosGlobais.push(ids.hGlobal);
    for (const [k, t] of [['hMontese', montese], ['hParceiro', parceiro]] as const) {
      const r = await db.client.query(
        "INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('tenant',$1,'quimico','TESTE Solvente') RETURNING id",
        [t.tenantId],
      );
      ids[k] = r.rows[0].id;
    }
    ids.cm = JSON.stringify(await cadeia(montese, 'M'));
    ids.cp = JSON.stringify(await cadeia(parceiro, 'P'));
  });

  afterAll(async () => {
    for (const id of criadosGlobais) await db.client.query('DELETE FROM pgr_hazards WHERE id = $1', [id]);
    await db.cleanup();
    await db.disconnect();
  });

  const cm = () => JSON.parse(ids.cm);
  const cp = () => JSON.parse(ids.cp);

  // --- permissões no CHECK ---
  it('CHECK de socio_permissions aceita pgr.read e pgr.write e continua rejeitando outras', async () => {
    const u = await db.createUserWithRole('socio', 'Socio PGR Perm');
    await expect(db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1,'pgr.read')", [u.userId])).resolves.toBeDefined();
    await expect(db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1,'pgr.write')", [u.userId])).resolves.toBeDefined();
    await expect(db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1,'pgr.delete')", [u.userId])).rejects.toThrow(/check/i);
    await expect(db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1,'empresas.read')", [u.userId])).resolves.toBeDefined();
  });

  // --- RLS ligado e FORCE ---
  it.each(['pgr_hazards', ...TABELAS_EMPRESA])('%s tem RLS habilitado e FORCE', async (t) => {
    const r = await db.client.query('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1', [t]);
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  // --- pgr_hazards ---
  it('CHECK de escopo: tenant exige tenant_id; global exige tenant_id nulo', async () => {
    await expect(
      db.client.query("INSERT INTO pgr_hazards (scope, category, name) VALUES ('tenant','fisico','TESTE sem tenant')"),
    ).rejects.toThrow(/check/i);
    await expect(
      db.client.query("INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('global',$1,'fisico','TESTE global com tenant')", [montese.tenantId]),
    ).rejects.toThrow(/check/i);
  });

  it('socio lê perigo global e perigo tenant de cliente Montese; não lê o de parceiro', async () => {
    const ver = (id: string) => comoSocio(async (c) => (await c.query('SELECT count(*)::int n FROM pgr_hazards WHERE id = $1', [id])).rows[0].n);
    expect(await ver(ids.hGlobal)).toBe(1);
    expect(await ver(ids.hMontese)).toBe(1);
    expect(await ver(ids.hParceiro)).toBe(0);
  });

  it('socio NÃO insere, atualiza nem apaga perigo global', async () => {
    await expect(
      comoSocio((c) => c.query("INSERT INTO pgr_hazards (scope, category, name) VALUES ('global','fisico','TESTE intruso')")),
    ).rejects.toThrow(/row-level security/i);
    await comoSocio(async (c) => {
      const u = await c.query("UPDATE pgr_hazards SET name = 'TESTE alterado' WHERE id = $1", [ids.hGlobal]);
      expect(u.rowCount).toBe(0);
      const d = await c.query('DELETE FROM pgr_hazards WHERE id = $1', [ids.hGlobal]);
      expect(d.rowCount).toBe(0);
    });
    const r = await db.client.query('SELECT name FROM pgr_hazards WHERE id = $1', [ids.hGlobal]);
    expect(r.rows[0].name).toBe('TESTE Ruído global');
  });

  it('socio insere perigo tenant em cliente Montese e não em parceiro', async () => {
    await comoSocio(async (c) => {
      const ok = await c.query(
        "INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('tenant',$1,'biologico','TESTE bio') RETURNING id",
        [montese.tenantId],
      );
      expect(ok.rowCount).toBe(1);
    });
    await expect(
      comoSocio((c) =>
        c.query("INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('tenant',$1,'biologico','TESTE bio')", [parceiro.tenantId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('socio edita perigo tenant de cliente Montese, mas não de parceiro; não migra para global', async () => {
    await comoSocio(async (c) => {
      expect((await c.query("UPDATE pgr_hazards SET description = 'x' WHERE id = $1", [ids.hMontese])).rowCount).toBe(1);
      expect((await c.query("UPDATE pgr_hazards SET description = 'x' WHERE id = $1", [ids.hParceiro])).rowCount).toBe(0);
    });
    await expect(
      comoSocio((c) => c.query("UPDATE pgr_hazards SET scope = 'global', tenant_id = NULL WHERE id = $1", [ids.hMontese])),
    ).rejects.toThrow(/row-level security|imutável/i);
  });

  it('perigo tenant de A não aparece no contexto de outro tenant (empresa)', async () => {
    const n = await comoPapel('empresa', montese2.userId, async (c) =>
      (await c.query('SELECT count(*)::int n FROM pgr_hazards')).rows[0].n, montese2.tenantId);
    expect(n).toBe(0);
  });

  // --- tabelas por empresa ---
  it.each(TABELAS_EMPRESA)('socio lê %s só de cliente Montese', async (t) => {
    const n = (tenantId: string) =>
      comoSocio(async (c) => (await c.query(`SELECT count(*)::int n FROM ${t} WHERE tenant_id = $1`, [tenantId])).rows[0].n);
    expect(await n(montese.tenantId)).toBe(1);
    expect(await n(parceiro.tenantId)).toBe(0);
  });

  it('socio faz CRUD em pgr_ghes/pgr_risks/controles/medições de cliente Montese', async () => {
    const m = cm();
    await comoSocio(async (c) => {
      const ghe = (await c.query("INSERT INTO pgr_ghes (tenant_id, name) VALUES ($1,'TESTE GHE novo') RETURNING id", [montese.tenantId])).rows[0].id;
      expect((await c.query("UPDATE pgr_ghes SET notes = 'n' WHERE id = $1", [ghe])).rowCount).toBe(1);
      const r = (await c.query(
        "INSERT INTO pgr_risks (tenant_id, ghe_id, category, name, exposure_type, hazard_id) VALUES ($1,$2,'fisico','TESTE R','habitual_permanente',$3) RETURNING id",
        [montese.tenantId, ghe, ids.hGlobal])).rows[0].id;
      await c.query("INSERT INTO pgr_risk_controls (tenant_id, risk_id, kind, status, description) VALUES ($1,$2,'administrativa','existente','TESTE c')", [montese.tenantId, r]);
      await c.query("INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent) VALUES ($1,$2,'TESTE a')", [montese.tenantId, r]);
      await c.query('INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) VALUES ($1,$2,$3)', [montese.tenantId, ghe, m.pos]);
      expect((await c.query('DELETE FROM pgr_risk_measurements WHERE risk_id = $1', [r])).rowCount).toBe(1);
      expect((await c.query('DELETE FROM pgr_risk_controls WHERE risk_id = $1', [r])).rowCount).toBe(1);
      expect((await c.query('DELETE FROM pgr_risks WHERE id = $1', [r])).rowCount).toBe(1);
      expect((await c.query('DELETE FROM pgr_ghe_positions WHERE ghe_id = $1', [ghe])).rowCount).toBe(1);
      expect((await c.query('DELETE FROM pgr_ghes WHERE id = $1', [ghe])).rowCount).toBe(1);
    });
  });

  it('socio nunca escreve em tabelas de cliente parceiro', async () => {
    const p = cp();
    const inserts: [string, string, any[]][] = [
      ['pgr_ghes', "INSERT INTO pgr_ghes (tenant_id, name) VALUES ($1,'TESTE X')", [parceiro.tenantId]],
      ['pgr_risks', "INSERT INTO pgr_risks (tenant_id, ghe_id, category, name, exposure_type) VALUES ($1,$2,'fisico','TESTE X','eventual')", [parceiro.tenantId, p.ghe]],
      ['pgr_risk_controls', "INSERT INTO pgr_risk_controls (tenant_id, risk_id, kind, status, description) VALUES ($1,$2,'epc','existente','TESTE X')", [parceiro.tenantId, p.risk]],
      ['pgr_risk_measurements', "INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent) VALUES ($1,$2,'TESTE X')", [parceiro.tenantId, p.risk]],
      ['pgr_ghe_positions', 'INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) VALUES ($1,$2,$3)', [parceiro.tenantId, p.ghe, p.pos]],
    ];
    for (const [, sql, args] of inserts) {
      await expect(comoSocio((c) => c.query(sql, args))).rejects.toThrow(/row-level security|tenant incoerente/i);
    }
    await comoSocio(async (c) => {
      for (const t of TABELAS_EMPRESA) {
        expect((await c.query(`UPDATE ${t} SET tenant_id = tenant_id WHERE tenant_id = $1`, [parceiro.tenantId])).rowCount).toBe(0);
        expect((await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [parceiro.tenantId])).rowCount).toBe(0);
      }
    });
  });

  it('socio não move linha de Montese para tenant de parceiro (WITH CHECK)', async () => {
    await expect(
      comoSocio((c) => c.query('UPDATE pgr_ghes SET tenant_id = $2 WHERE id = $1', [cm().ghe, parceiro.tenantId])),
    ).rejects.toThrow(/row-level security|imutável/i);
  });

  it.each(['pgr_hazards', ...TABELAS_EMPRESA])('empresa e parceiro não leem nada de %s', async (t) => {
    for (const [role, tenant, user] of [
      ['empresa', montese.tenantId, montese.userId],
      ['parceiro', '', tecnico.userId],
    ] as const) {
      const n = await comoPapel(role, user, async (c) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n, tenant);
      expect(n).toBe(0);
    }
  });

  it.each(['pgr_hazards', ...TABELAS_EMPRESA])('tecnico não lê %s', async (t) => {
    const n = await comoPapel('tecnico', tecnico.userId, async (c) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n);
    expect(n).toBe(0);
  });

  // M-9: tecnico e parceiro (e empresa) não leem nem escrevem em NENHUMA das 6 tabelas.
  const INSERTS: Record<string, (t: string) => { sql: string; params: unknown[] }> = {
    pgr_hazards: (t) => ({ sql: "INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('tenant',$1,'fisico','TESTE rls papel')", params: [t] }),
    pgr_ghes: (t) => ({ sql: "INSERT INTO pgr_ghes (tenant_id, name) VALUES ($1,'TESTE rls papel')", params: [t] }),
    pgr_ghe_positions: (t) => ({ sql: 'INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) VALUES ($1,$2,$3)', params: [t, cm().ghe, cm().pos] }),
    pgr_risks: (t) => ({ sql: "INSERT INTO pgr_risks (tenant_id, ghe_id, category, name, exposure_type) VALUES ($1,$2,'fisico','TESTE rls papel','eventual')", params: [t, cm().ghe] }),
    pgr_risk_controls: (t) => ({ sql: "INSERT INTO pgr_risk_controls (tenant_id, risk_id, kind, description) VALUES ($1,$2,'epc','TESTE')", params: [t, cm().risk] }),
    pgr_risk_measurements: (t) => ({ sql: "INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent) VALUES ($1,$2,'TESTE')", params: [t, cm().risk] }),
  };
  it.each(Object.keys(INSERTS))('tecnico, parceiro e empresa não leem, inserem, alteram nem apagam em %s', async (t) => {
    const papeis = [
      ['tecnico', tecnico.userId, ''],
      ['parceiro', tecnico.userId, ''],
      ['parceiro', tecnico.userId, montese.tenantId],
      ['empresa', montese.userId, montese.tenantId],
    ] as const;
    for (const [role, user, tenant] of papeis) {
      const r = await comoPapel(role, user, async (c) => {
        const lidas = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
        const upd = (await c.query(`UPDATE ${t} SET updated_at = now()`)).rowCount;
        const del = (await c.query(`DELETE FROM ${t}`)).rowCount;
        await c.query('SAVEPOINT s');
        const q = INSERTS[t](montese.tenantId);
        const ins = await c.query(q.sql, q.params).then(() => 'inseriu', (e: Error) => e.message);
        return { lidas, upd, del, ins };
      }, tenant);
      expect({ role, tenant: !!tenant, lidas: r.lidas, upd: r.upd, del: r.del }).toEqual({ role, tenant: !!tenant, lidas: 0, upd: 0, del: 0 });
      expect(r.ins).toMatch(/row-level security|violates|permission denied|tenant incoerente/); // filhos: o pai invisível pela RLS cai no trigger de coerência
    }
  });

  it('admin lê e escreve em todas', async () => {
    const adm = await db.createUserWithRole('admin', 'Admin PGR');
    await comoPapel('admin', adm.userId, async (c) => {
      for (const t of ['pgr_hazards', ...TABELAS_EMPRESA]) {
        expect((await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n).toBeGreaterThanOrEqual(1);
      }
      await c.query("INSERT INTO pgr_hazards (scope, category, name) VALUES ('global','fisico','TESTE admin global')");
    });
  });

  // --- coerência de tenant (triggers) ---
  describe('coerência de tenant entre filho e pai', () => {
    it('pgr_ghe_positions rejeita cargo de outro tenant', async () => {
      await expect(
        db.client.query('INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) VALUES ($1,$2,$3)', [montese.tenantId, cm().ghe, cp().pos]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_ghe_positions rejeita GHE de outro tenant', async () => {
      await expect(
        db.client.query('INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) VALUES ($1,$2,$3)', [montese.tenantId, cp().ghe, cm().pos]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_ghe_positions rejeita UPDATE que troca o cargo por um de outro tenant', async () => {
      await expect(
        db.client.query('UPDATE pgr_ghe_positions SET position_id = $2 WHERE id = $1', [cm().vinc, cp().pos]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_ghes rejeita unidade de outro tenant', async () => {
      const u = await db.insertRawRow('company_units', {
        tenant_id: parceiro.tenantId, name: 'TESTE Unidade', address_street: 'Rua', address_city: 'Cidade', address_state: 'SP', address_zip: '01001000',
      });
      await expect(
        db.client.query("INSERT INTO pgr_ghes (tenant_id, name, company_unit_id) VALUES ($1,'TESTE GHE U',$2)", [montese.tenantId, u]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_risks rejeita GHE de outro tenant', async () => {
      await expect(
        db.client.query("INSERT INTO pgr_risks (tenant_id, ghe_id, category, name, exposure_type) VALUES ($1,$2,'fisico','TESTE R','eventual')", [montese.tenantId, cp().ghe]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_risks rejeita perigo tenant de outro tenant, mas aceita perigo global', async () => {
      await expect(
        db.client.query("INSERT INTO pgr_risks (tenant_id, ghe_id, hazard_id, category, name, exposure_type) VALUES ($1,$2,$3,'fisico','TESTE R','eventual')", [montese.tenantId, cm().ghe, ids.hParceiro]),
      ).rejects.toThrow(/tenant/i);
      await expect(
        db.client.query("INSERT INTO pgr_risks (tenant_id, ghe_id, hazard_id, category, name, exposure_type) VALUES ($1,$2,$3,'fisico','TESTE R ok','eventual')", [montese.tenantId, cm().ghe, ids.hGlobal]),
      ).resolves.toBeDefined();
    });
    it('pgr_risk_controls e pgr_risk_measurements rejeitam risco de outro tenant', async () => {
      await expect(
        db.client.query("INSERT INTO pgr_risk_controls (tenant_id, risk_id, kind, status, description) VALUES ($1,$2,'epc','existente','TESTE')", [montese.tenantId, cp().risk]),
      ).rejects.toThrow(/tenant/i);
      await expect(
        db.client.query("INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent) VALUES ($1,$2,'TESTE')", [montese.tenantId, cp().risk]),
      ).rejects.toThrow(/tenant/i);
    });
    it('pgr_risk_controls rejeita UPDATE de risk_id para risco de outro tenant', async () => {
      await expect(
        db.client.query('UPDATE pgr_risk_controls SET risk_id = $2 WHERE id = $1', [cm().ctrl, cp().risk]),
      ).rejects.toThrow(/tenant/i);
    });
  });

  describe('imutabilidade de tenant e vínculos adicionais', () => {
    it('tenant_id não muda nem entre clientes Montese (ghes, risks, hazards)', async () => {
      await expect(db.client.query('UPDATE pgr_ghes SET tenant_id = $2 WHERE id = $1', [cm().ghe, montese2.tenantId])).rejects.toThrow(/imutável/);
      await expect(db.client.query('UPDATE pgr_risks SET tenant_id = $2 WHERE id = $1', [cm().risk, montese2.tenantId])).rejects.toThrow(/imutável|tenant incoerente/);
      await expect(db.client.query('UPDATE pgr_hazards SET tenant_id = $2 WHERE id = $1', [ids.hMontese, montese2.tenantId])).rejects.toThrow(/imutável/);
      await expect(
        comoSocio((c) => c.query('UPDATE pgr_ghes SET tenant_id = $2 WHERE id = $1', [cm().ghe, montese2.tenantId])),
      ).rejects.toThrow(/imutável/);
    });
    it('scope do perigo não muda', async () => {
      await expect(db.client.query("UPDATE pgr_hazards SET scope = 'global', tenant_id = NULL WHERE id = $1", [ids.hMontese])).rejects.toThrow(/imutável/);
    });
    it('medição: documento de outro tenant/invisível é rejeitado; documento Montese visível é aceito', async () => {
      const mkDoc = (t: { tenantId: string; userId: string }) =>
        db.insertRawRow('documents', {
          tenant_id: t.tenantId, category: 'laudo', title: 'TESTE laudo', file_key: `rls/${Math.random()}`,
          file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, uploaded_by_user_id: t.userId, uploaded_by_role: 'empresa',
        });
      const dM = await mkDoc(montese);
      const dP = await mkDoc(parceiro);
      await expect(
        db.client.query("INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent, document_id) VALUES ($1,$2,'TESTE',$3)", [montese.tenantId, cm().risk, dP]),
      ).rejects.toThrow(/tenant incoerente/);
      await expect(
        comoSocio((c) => c.query("INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent, document_id) VALUES ($1,$2,'TESTE',$3)", [montese.tenantId, cm().risk, dP])),
      ).rejects.toThrow(/tenant incoerente/);
      await comoSocio(async (c) => {
        const r = await c.query("INSERT INTO pgr_risk_measurements (tenant_id, risk_id, agent, document_id) VALUES ($1,$2,'TESTE',$3)", [montese.tenantId, cm().risk, dM]);
        expect(r.rowCount).toBe(1);
      });
    });
    it('socio define company_unit_id em GHE Montese; unidade de outro tenant é rejeitada', async () => {
      const mkUnit = (t: { tenantId: string }) =>
        db.insertRawRow('company_units', {
          tenant_id: t.tenantId, name: 'TESTE Unidade S', address_street: 'Rua', address_city: 'Cidade', address_state: 'SP', address_zip: '01001000',
        });
      const uM = await mkUnit(montese);
      const uP = await mkUnit(parceiro);
      await comoSocio(async (c) => {
        const r = await c.query('UPDATE pgr_ghes SET company_unit_id = $2 WHERE id = $1', [cm().ghe, uM]);
        expect(r.rowCount).toBe(1);
      });
      await expect(
        comoSocio((c) => c.query('UPDATE pgr_ghes SET company_unit_id = $2 WHERE id = $1', [cm().ghe, uP])),
      ).rejects.toThrow(/tenant incoerente/);
    });
  });

  it('apagar perigo da biblioteca mantém o risco (hazard_id vira NULL)', async () => {
    const h = await db.client.query("INSERT INTO pgr_hazards (scope, tenant_id, category, name) VALUES ('tenant',$1,'fisico','TESTE temp') RETURNING id", [montese.tenantId]);
    const r = await db.insertRawRow('pgr_risks', {
      tenant_id: montese.tenantId, ghe_id: cm().ghe, hazard_id: h.rows[0].id, category: 'fisico', name: 'TESTE R temp', exposure_type: 'eventual',
    });
    await db.client.query('DELETE FROM pgr_hazards WHERE id = $1', [h.rows[0].id]);
    const x = await db.client.query('SELECT hazard_id FROM pgr_risks WHERE id = $1', [r]);
    expect(x.rows[0].hazard_id).toBeNull();
  });
});
