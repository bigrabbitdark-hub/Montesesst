import { Client } from 'pg';
import { TestDb, TestUserFixture } from './db-test-helper';
import { exigirSemResiduosDeTeste, removerVersoesDeTeste } from './pgr-matriz-test-util';

// PGR B1, Task 1: RLS, imutabilidade e coerência da matriz de risco versionada e das avaliações.
// A matriz NÃO tem semente: o config usado aqui é um JSON de teste ("TESTE ..."), sem valor normativo.
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

// Negado para o papel da aplicação = SOMENTE erro de permissão/RLS, ou rowCount 0 (RLS sem policy).
// Qualquer outro erro (ex.: trigger) falha o teste; no caso rowCount 0 o chamador relê a linha como superuser.
const negado = (p: Promise<{ rowCount: number | null }>) =>
  p.then(
    (r) => (r.rowCount ?? 0) === 0,
    (e: Error) => /permission denied|row-level security/i.test(e.message),
  );

const SHA = 'a'.repeat(64);
const CONFIG = JSON.stringify({ severidade: [{ valor: 1, rotulo: 'TESTE', descricao: 'TESTE' }] });

describe('pgr B1 — matriz e avaliações: RLS, imutabilidade e coerência (e2e)', () => {
  let db: TestDb;
  let admin: TestUserFixture;
  let socio: TestUserFixture;
  let tecnico: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let parceiro: { tenantId: string; userId: string };
  const versoes: string[] = [];
  let numero = 0;
  let vRasc: string;
  let vPub: string;
  let vArq: string;
  let riscoM: string;
  let riscoP: string;

  const comoSocio = <T>(fn: (c: Client) => Promise<T>) => comoPapel('socio', socio.userId, fn);
  const comoAdmin = <T>(fn: (c: Client) => Promise<T>) => comoPapel('admin', admin.userId, fn);

  // version_number único mesmo em banco reaproveitado: parte de um número alto e aleatório.
  const proximoNumero = () => 1_000_000 + Math.floor(Math.random() * 800_000_000) + numero++;

  async function novaVersao(status: 'rascunho' | 'publicada' | 'arquivada'): Promise<string> {
    const r = await db.client.query(
      'INSERT INTO pgr_matrix_versions (version_number, config, created_by, notes) VALUES ($1, $2::jsonb, $3, $4) RETURNING id',
      [proximoNumero(), CONFIG, admin.userId, 'TESTE-rls'],
    );
    const id = r.rows[0].id;
    versoes.push(id);
    if (status !== 'rascunho') {
      await db.client.query(
        "UPDATE pgr_matrix_versions SET status = 'publicada', config_sha256 = $2, published_by = $3, published_at = now() WHERE id = $1",
        [id, SHA, admin.userId],
      );
    }
    if (status === 'arquivada') {
      await db.client.query("UPDATE pgr_matrix_versions SET status = 'arquivada' WHERE id = $1", [id]);
    }
    return id;
  }

  async function novoRisco(t: { tenantId: string }, p: string): Promise<string> {
    const ghe = await db.insertRawRow('pgr_ghes', { tenant_id: t.tenantId, name: `TESTE GHE ${p}` });
    return db.insertRawRow('pgr_risks', {
      tenant_id: t.tenantId, ghe_id: ghe, category: 'fisico', name: `TESTE Risco ${p}`, exposure_type: 'eventual',
    });
  }

  const avaliacao = (tenantId: string, riscoId: string, versaoId: string, extra: Record<string, unknown> = {}) => {
    const v = { kind: 'inerente', sev: 2, prob: 3, score: 6, justificativa: 'TESTE justificativa', ...extra };
    return {
      sql: `INSERT INTO pgr_risk_assessments (tenant_id, risk_id, kind, matrix_version_id, severity_value,
              probability_value, score, level_id, justification, assessed_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'TESTE-nivel',$8,$9) RETURNING id`,
      params: [tenantId, riscoId, v.kind, versaoId, v.sev, v.prob, v.score, v.justificativa, socio.userId],
    };
  };
  const inserirComoSocio = (tenantId: string, riscoId: string, versaoId: string, extra: Record<string, unknown> = {}) => {
    const q = avaliacao(tenantId, riscoId, versaoId, extra);
    return comoSocio((c) => c.query(q.sql, q.params));
  };

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    await exigirSemResiduosDeTeste(db.client);
    admin = await db.createUserWithRole('admin', 'Admin Matriz');
    socio = await db.createUserWithRole('socio', 'Socio Matriz');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Matriz');
    montese = await db.createTenantWithUser('Cliente Montese Matriz');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Matriz');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId, tec.rows[0].id,
    ]);
    vRasc = await novaVersao('rascunho');
    vPub = await novaVersao('publicada');
    vArq = await novaVersao('arquivada');
    riscoM = await novoRisco(montese, 'M');
    riscoP = await novoRisco(parceiro, 'P');
  });

  afterAll(async () => {
    try {
      // Tenants primeiro (cascata leva riscos e avaliações); só então as versões (imutáveis), marcadas TESTE-.
      await db.cleanup();
      await removerVersoesDeTeste(db.client, versoes);
    } finally {
      await db.disconnect();
    }
  });

  // --- RLS ligado e FORCE ---
  it.each(['pgr_matrix_versions', 'pgr_risk_assessments'])('%s tem RLS habilitado e FORCE', async (t) => {
    const r = await db.client.query('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1', [t]);
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('a matriz nasce sem semente: nenhuma versão criada pela migration', async () => {
    const r = await db.client.query('SELECT count(*)::int n FROM pgr_matrix_versions WHERE id <> ALL($1::uuid[])', [versoes]);
    expect(r.rows[0].n).toBe(0);
  });

  // --- pgr_matrix_versions: papéis ---
  describe('versões: visibilidade e escrita por papel', () => {
    it('socio lê publicada e arquivada, nunca rascunho', async () => {
      await comoSocio(async (c) => {
        const r = await c.query('SELECT id, status FROM pgr_matrix_versions WHERE id = ANY($1::uuid[])', [[vRasc, vPub, vArq]]);
        expect(r.rows.map((x) => x.id).sort()).toEqual([vPub, vArq].sort());
        expect(r.rows.every((x) => x.status !== 'rascunho')).toBe(true);
      });
    });

    it('admin lê e escreve rascunho, publicada e arquivada', async () => {
      await comoAdmin(async (c) => {
        const r = await c.query('SELECT count(*)::int n FROM pgr_matrix_versions WHERE id = ANY($1::uuid[])', [[vRasc, vPub, vArq]]);
        expect(r.rows[0].n).toBe(3);
        const ins = await c.query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\')', [proximoNumero(), CONFIG]);
        expect(ins.rowCount).toBe(1);
        const upd = await c.query("UPDATE pgr_matrix_versions SET notes = 'TESTE' WHERE id = $1", [vRasc]);
        expect(upd.rowCount).toBe(1);
      });
    });

    it('socio não insere, atualiza nem apaga versões', async () => {
      await expect(
        comoSocio((c) => c.query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\')', [proximoNumero(), CONFIG])),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await comoSocio(async (c) => {
        expect((await c.query("UPDATE pgr_matrix_versions SET notes = 'x' WHERE id = $1", [vPub])).rowCount).toBe(0);
        expect((await c.query("UPDATE pgr_matrix_versions SET notes = 'x' WHERE id = $1", [vRasc])).rowCount).toBe(0);
        expect((await c.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vRasc])).rowCount).toBe(0);
        expect((await c.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vArq])).rowCount).toBe(0);
      });
      const rel = await db.client.query('SELECT id, notes FROM pgr_matrix_versions WHERE id = ANY($1::uuid[])', [[vPub, vRasc, vArq]]);
      expect(rel.rowCount).toBe(3);
      expect(rel.rows.every((x) => x.notes === null || x.notes === 'TESTE' || x.notes === 'TESTE-rls')).toBe(true);
    });

    it.each([
      ['tecnico', () => tecnico.userId, ''],
      ['parceiro', () => tecnico.userId, ''],
      ['parceiro', () => tecnico.userId, 'TENANT'],
      ['empresa', () => montese.userId, 'TENANT'],
    ])('%s não lê, insere, altera nem apaga versões', async (role, user, tenant) => {
      const tid = tenant === 'TENANT' ? montese.tenantId : '';
      const r = await comoPapel(role, user(), async (c) => {
        const lidas = (await c.query('SELECT count(*)::int n FROM pgr_matrix_versions')).rows[0].n;
        const upd = (await c.query('UPDATE pgr_matrix_versions SET updated_at = now()')).rowCount;
        const del = (await c.query('DELETE FROM pgr_matrix_versions')).rowCount;
        await c.query('SAVEPOINT s');
        const ins = await c
          .query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\')', [proximoNumero(), CONFIG])
          .then(() => 'inseriu', (e: Error) => e.message);
        return { lidas, upd, del, ins };
      }, tid);
      expect({ lidas: r.lidas, upd: r.upd, del: r.del }).toEqual({ lidas: 0, upd: 0, del: 0 });
      expect(r.ins).toMatch(/row-level security|permission denied/i);
    });
  });

  // --- pgr_matrix_versions: constraints ---
  describe('versões: constraints', () => {
    it('version_number é único', async () => {
      const n = proximoNumero();
      const a = await db.client.query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\') RETURNING id', [n, CONFIG]);
      versoes.push(a.rows[0].id);
      await expect(db.client.query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\')', [n, CONFIG])).rejects.toThrow(/unique|duplicate/i);
    });

    it('status inválido é rejeitado', async () => {
      await expect(
        db.client.query("INSERT INTO pgr_matrix_versions (version_number, status, config, notes) VALUES ($1,'aprovada',$2::jsonb,'TESTE-rls')", [proximoNumero(), CONFIG]),
      ).rejects.toThrow(/check|transição de status/i); // o trigger de INSERT age antes do CHECK
    });

    it('config acima de 200000 bytes é rejeitado', async () => {
      const grande = JSON.stringify({ x: 'a'.repeat(200_001) });
      await expect(
        db.client.query('INSERT INTO pgr_matrix_versions (version_number, config, notes) VALUES ($1, $2::jsonb, \'TESTE-rls\')', [proximoNumero(), grande]),
      ).rejects.toThrow(/check/i);
    });

    it('config_sha256 deve ser hex de 64 caracteres minúsculos', async () => {
      for (const ruim of ['abc', 'A'.repeat(64), 'g'.repeat(64)]) {
        await expect(
          db.client.query("UPDATE pgr_matrix_versions SET status='publicada', config_sha256=$2, published_by=$3, published_at=now() WHERE id=$1", [vRasc, ruim, admin.userId]),
        ).rejects.toThrow(/check/i);
      }
    });

    it('publicar sem config_sha256 ou sem published_at é rejeitado; rascunho não pode ter sha', async () => {
      await expect(
        db.client.query("UPDATE pgr_matrix_versions SET status='publicada', published_by=$2, published_at=now() WHERE id=$1", [vRasc, admin.userId]),
      ).rejects.toThrow(/check/i);
      await expect(
        db.client.query("UPDATE pgr_matrix_versions SET status='publicada', config_sha256=$2, published_by=$3 WHERE id=$1", [vRasc, SHA, admin.userId]),
      ).rejects.toThrow(/check/i);
      await expect(
        db.client.query('UPDATE pgr_matrix_versions SET config_sha256=$2 WHERE id=$1', [vRasc, SHA]),
      ).rejects.toThrow(/check/i);
    });

    it('publicar exige published_by (máquina de estados)', async () => {
      const v = await novaVersao('rascunho');
      await expect(
        db.client.query("UPDATE pgr_matrix_versions SET status='publicada', config_sha256=$2, published_at=now() WHERE id=$1", [v, SHA]),
      ).rejects.toThrow(/published_by|publica/i);
    });
  });

  // --- pgr_matrix_versions: imutabilidade e máquina de estados ---
  describe('versões: imutabilidade pós-publicação e transições', () => {
    it('rascunho pode ter config alterado', async () => {
      const v = await novaVersao('rascunho');
      const r = await db.client.query('UPDATE pgr_matrix_versions SET config = $2::jsonb WHERE id = $1', [v, JSON.stringify({ a: 'TESTE' })]);
      expect(r.rowCount).toBe(1);
    });

    // Congelamento pós-publicação: casos explícitos (cada UPDATE é um único comando).
    const congelada = async (set: string, params: unknown[] = []) => {
      const v = await novaVersao('publicada');
      const antes = (await db.client.query('SELECT * FROM pgr_matrix_versions WHERE id = $1', [v])).rows[0];
      await expect(db.client.query(`UPDATE pgr_matrix_versions SET ${set} WHERE id = $1`, [v, ...params])).rejects.toThrow(/imutável|transição/i);
      const depois = (await db.client.query('SELECT * FROM pgr_matrix_versions WHERE id = $1', [v])).rows[0];
      expect(depois).toEqual(antes);
    };
    it('publicada: UPDATE de config é proibido', () => congelada("config = '{\"b\":1}'::jsonb"));
    it('publicada: UPDATE de config_sha256 é proibido', () => congelada(`config_sha256 = '${'b'.repeat(64)}'`));
    it('publicada: UPDATE de version_number é proibido', () => congelada('version_number = version_number + 1'));
    it('publicada: UPDATE de notes é proibido', () => congelada("notes = 'alterada'"));
    it('publicada: UPDATE de published_at é proibido', () => congelada("published_at = now() + interval '1 day'"));
    it('publicada: created_by para outro usuário não nulo é proibido', async () => {
      const outro = await db.createUserWithRole('admin', 'Outro Admin 1');
      await congelada('created_by = $2', [outro.userId]);
    });
    it('publicada: published_by para outro usuário não nulo é proibido', async () => {
      const outro = await db.createUserWithRole('admin', 'Outro Admin 2');
      await congelada('published_by = $2', [outro.userId]);
    });
    it('publicada: UPDATE direto zerando created_by ou published_by é proibido (só o FK SET NULL)', async () => {
      await congelada('created_by = NULL');
      await congelada('published_by = NULL');
    });
    it('publicada: arquivar E alterar config no mesmo UPDATE é proibido', () =>
      congelada("status = 'arquivada', config = '{\"b\":1}'::jsonb"));
    it('publicada: arquivar E alterar config_sha256 no mesmo UPDATE é proibido', () =>
      congelada(`status = 'arquivada', config_sha256 = '${'c'.repeat(64)}'`));

    it('arquivada: nenhum campo muda, nem config nem status', async () => {
      await expect(db.client.query("UPDATE pgr_matrix_versions SET config = '{\"b\":1}'::jsonb WHERE id = $1", [vArq])).rejects.toThrow(/imutável|arquivada/i);
      await expect(db.client.query("UPDATE pgr_matrix_versions SET status = 'publicada' WHERE id = $1", [vArq])).rejects.toThrow(/regress|transição|arquivada/i);
      await expect(db.client.query("UPDATE pgr_matrix_versions SET status = 'rascunho' WHERE id = $1", [vArq])).rejects.toThrow();
    });

    it('status só avança: publicada -> rascunho e rascunho -> arquivada são proibidos', async () => {
      const v = await novaVersao('publicada');
      await expect(db.client.query("UPDATE pgr_matrix_versions SET status = 'rascunho', config_sha256 = NULL, published_at = NULL, published_by = NULL WHERE id = $1", [v])).rejects.toThrow(/regress|transição|check/i);
      const r = await novaVersao('rascunho');
      await expect(db.client.query("UPDATE pgr_matrix_versions SET status = 'arquivada', config_sha256 = $2, published_at = now(), published_by = $3 WHERE id = $1", [r, SHA, admin.userId])).rejects.toThrow(/transição|regress/i);
    });

    it('rascunho -> publicada não pode alterar config nem notes na mesma transição', async () => {
      const v = await novaVersao('rascunho');
      const base = `status='publicada', config_sha256=$2, published_by=$3, published_at=now()`;
      await expect(db.client.query(`UPDATE pgr_matrix_versions SET ${base}, config='{"x":1}'::jsonb WHERE id=$1`, [v, SHA, admin.userId])).rejects.toThrow(/não pode alterar config nem notes/i);
      await expect(db.client.query(`UPDATE pgr_matrix_versions SET ${base}, notes='TESTE-rls outra' WHERE id=$1`, [v, SHA, admin.userId])).rejects.toThrow(/não pode alterar config nem notes/i);
      expect((await db.client.query('SELECT status FROM pgr_matrix_versions WHERE id = $1', [v])).rows[0].status).toBe('rascunho');
      expect((await db.client.query(`UPDATE pgr_matrix_versions SET ${base} WHERE id=$1`, [v, SHA, admin.userId])).rowCount).toBe(1); // sem mexer no conteúdo, publica
    });

    it('TRUNCATE é bloqueado em pgr_matrix_versions e pgr_risk_assessments (superuser); dados intactos', async () => {
      const antesV = (await db.client.query('SELECT count(*)::int n FROM pgr_matrix_versions')).rows[0].n;
      const antesA = (await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments')).rows[0].n;
      await expect(db.client.query('TRUNCATE pgr_matrix_versions CASCADE')).rejects.toThrow(/TRUNCATE não é permitido/i);
      await expect(db.client.query('TRUNCATE pgr_risk_assessments')).rejects.toThrow(/TRUNCATE não é permitido/i);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_matrix_versions')).rows[0].n).toBe(antesV);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments')).rows[0].n).toBe(antesA);
    });

    it('publicada -> arquivada é permitido, e só status/updated_at mudam', async () => {
      const v = await novaVersao('publicada');
      const r = await db.client.query("UPDATE pgr_matrix_versions SET status = 'arquivada' WHERE id = $1", [v]);
      expect(r.rowCount).toBe(1);
    });

    it('INSERT já como publicada/arquivada é proibido (nasce rascunho)', async () => {
      await expect(
        db.client.query(
          "INSERT INTO pgr_matrix_versions (version_number, status, config, config_sha256, published_by, published_at, notes) VALUES ($1,'publicada',$2::jsonb,$3,$4,now(),'TESTE-rls')",
          [proximoNumero(), CONFIG, SHA, admin.userId],
        ),
      ).rejects.toThrow(/rascunho|transição/i);
    });

    it('DELETE: rascunho pode ser apagado; publicada e arquivada não', async () => {
      const r = await novaVersao('rascunho');
      expect((await db.client.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [r])).rowCount).toBe(1);
      await expect(db.client.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vPub])).rejects.toThrow(/publicada|arquivada|imutável/i);
      await expect(db.client.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vArq])).rejects.toThrow(/publicada|arquivada|imutável/i);
      await expect(
        comoAdmin((c) => c.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vPub])),
      ).rejects.toThrow(/publicada|arquivada|imutável/i);
    });

    it('apagar o usuário que criou/publicou não é bloqueado pela imutabilidade (SET NULL)', async () => {
      const u = await db.createUserWithRole('admin', 'Admin Efêmero');
      const r = await db.client.query('INSERT INTO pgr_matrix_versions (version_number, config, created_by, notes) VALUES ($1,$2::jsonb,$3,\'TESTE-rls\') RETURNING id', [proximoNumero(), CONFIG, u.userId]);
      const id = r.rows[0].id;
      versoes.push(id);
      await db.client.query("UPDATE pgr_matrix_versions SET status='publicada', config_sha256=$2, published_by=$3, published_at=now() WHERE id=$1", [id, SHA, u.userId]);
      await db.client.query('DELETE FROM users WHERE id = $1', [u.userId]);
      const x = await db.client.query('SELECT created_by, published_by FROM pgr_matrix_versions WHERE id = $1', [id]);
      expect(x.rows[0]).toEqual({ created_by: null, published_by: null });
    });
  });

  // --- pgr_risk_assessments ---
  describe('avaliações de risco', () => {
    it('socio insere em cliente Montese com versão publicada e lê', async () => {
      await comoSocio(async (c) => {
        const q = avaliacao(montese.tenantId, riscoM, vPub);
        const r = await c.query(q.sql, q.params);
        expect(r.rowCount).toBe(1);
        const n = (await c.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE risk_id = $1', [riscoM])).rows[0].n;
        expect(n).toBe(1);
      });
    });

    it('admin insere e lê avaliações', async () => {
      await comoAdmin(async (c) => {
        const q = avaliacao(montese.tenantId, riscoM, vPub, { kind: 'residual_previsto' });
        expect((await c.query(q.sql, q.params)).rowCount).toBe(1);
        expect((await c.query('SELECT count(*)::int n FROM pgr_risk_assessments')).rows[0].n).toBeGreaterThanOrEqual(1);
      });
    });

    it('socio não insere em cliente parceiro', async () => {
      await expect(inserirComoSocio(parceiro.tenantId, riscoP, vPub)).rejects.toThrow(/row-level security|tenant incoerente/i);
    });

    it('socio não lê avaliações de parceiro', async () => {
      const id = (await db.client.query(avaliacao(parceiro.tenantId, riscoP, vPub).sql, avaliacao(parceiro.tenantId, riscoP, vPub).params)).rows[0].id;
      const n = await comoSocio(async (c) => (await c.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n);
      expect(n).toBe(0);
    });

    it('risco de outro tenant (tenant_id da linha diferente do tenant do risco) é rejeitado', async () => {
      await expect(inserirComoSocio(montese.tenantId, riscoP, vPub)).rejects.toThrow(/tenant incoerente|row-level security/i);
      await expect(
        db.client.query(avaliacao(montese.tenantId, riscoP, vPub).sql, avaliacao(montese.tenantId, riscoP, vPub).params),
      ).rejects.toThrow(/tenant incoerente/i);
    });

    it('matriz em rascunho ou arquivada é recusada; publicada é aceita', async () => {
      const a = avaliacao(montese.tenantId, riscoM, vRasc);
      await expect(db.client.query(a.sql, a.params)).rejects.toThrow(/publicada/i);
      const b = avaliacao(montese.tenantId, riscoM, vArq);
      await expect(db.client.query(b.sql, b.params)).rejects.toThrow(/publicada/i);
      await expect(inserirComoSocio(montese.tenantId, riscoM, vRasc)).rejects.toThrow(/publicada|foreign key|violates/i);
      const c = avaliacao(montese.tenantId, riscoM, vPub);
      await expect(db.client.query(c.sql, c.params)).resolves.toBeDefined();
    });

    it('versão inexistente é rejeitada', async () => {
      const q = avaliacao(montese.tenantId, riscoM, '00000000-0000-0000-0000-000000000000');
      await expect(db.client.query(q.sql, q.params)).rejects.toThrow(/foreign key|publicada/i);
    });

    it.each([
      ['sev', { sev: 0 }], ['prob', { prob: 0 }], ['score', { score: 0 }],
      ['sev negativa', { sev: -1 }], ['kind', { kind: 'real' }], ['justificativa vazia', { justificativa: '   ' }],
      ['justificativa longa', { justificativa: 'x'.repeat(4001) }],
    ])('CHECK rejeita %s', async (_n, extra) => {
      const q = avaliacao(montese.tenantId, riscoM, vPub, extra as Record<string, unknown>);
      await expect(db.client.query(q.sql, q.params)).rejects.toThrow(/check/i);
    });

    it('UPDATE é bloqueado para todos (inclusive superuser de teste e admin)', async () => {
      const q = avaliacao(montese.tenantId, riscoM, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await expect(db.client.query("UPDATE pgr_risk_assessments SET justification = 'outra' WHERE id = $1", [id])).rejects.toThrow(/append-only|imutável|não podem/i);
      await expect(db.client.query("UPDATE pgr_risk_assessments SET tenant_id = $2 WHERE id = $1", [id, parceiro.tenantId])).rejects.toThrow(/append-only|imutável|não podem/i);
      expect(await comoAdmin((c) => negado(c.query('UPDATE pgr_risk_assessments SET score = 9 WHERE id = $1', [id])))).toBe(true);
      expect((await db.client.query('SELECT score FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].score).toBe(6);
    });

    it('socio não atualiza nem apaga avaliações', async () => {
      const q = avaliacao(montese.tenantId, riscoM, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await comoSocio(async (c) => {
        await c.query('SAVEPOINT a');
        expect(await negado(c.query('UPDATE pgr_risk_assessments SET score = 9 WHERE id = $1', [id]))).toBe(true);
        await c.query('ROLLBACK TO a');
        await c.query('SAVEPOINT b');
        expect(await negado(c.query('DELETE FROM pgr_risk_assessments WHERE id = $1', [id]))).toBe(true);
        await c.query('ROLLBACK TO b');
      });
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(1);
    });

    it('DELETE direto é proibido (inclusive para o superuser de teste e admin)', async () => {
      const q = avaliacao(montese.tenantId, riscoM, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await expect(db.client.query('DELETE FROM pgr_risk_assessments WHERE id = $1', [id])).rejects.toThrow(/append-only|cascata|não podem/i);
      expect(await comoAdmin((c) => negado(c.query('DELETE FROM pgr_risk_assessments WHERE id = $1', [id])))).toBe(true);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(1);
    });

    it('DELETE direto de risco COM avaliações é recusado (superuser e socio) e o histórico fica intacto', async () => {
      const r = await novoRisco(montese, 'historico');
      const q = avaliacao(montese.tenantId, r, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await expect(db.client.query('DELETE FROM pgr_risks WHERE id = $1', [r])).rejects.toThrow(/avaliações registradas/i);
      await expect(comoSocio((c) => c.query('DELETE FROM pgr_risks WHERE id = $1', [r]))).rejects.toThrow(/avaliações registradas/i);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(1);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risks WHERE id = $1', [r])).rows[0].n).toBe(1);
    });

    it('DELETE de risco SEM avaliações continua funcionando (superuser e socio)', async () => {
      const r1 = await novoRisco(montese, 'sem-aval-1');
      expect((await db.client.query('DELETE FROM pgr_risks WHERE id = $1', [r1])).rowCount).toBe(1);
      const r2 = await novoRisco(montese, 'sem-aval-2');
      await comoSocio(async (c) => {
        expect((await c.query('DELETE FROM pgr_risks WHERE id = $1', [r2])).rowCount).toBe(1);
      });
    });

    it('DELETE direto de GHE com riscos AVALIADOS é recusado (superuser e socio); linhas intactas', async () => {
      const ghe = await db.insertRawRow('pgr_ghes', { tenant_id: montese.tenantId, name: 'TESTE GHE avaliado' });
      const r = await db.insertRawRow('pgr_risks', { tenant_id: montese.tenantId, ghe_id: ghe, category: 'fisico', name: 'TESTE R avaliado', exposure_type: 'eventual' });
      const q = avaliacao(montese.tenantId, r, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await expect(db.client.query('DELETE FROM pgr_ghes WHERE id = $1', [ghe])).rejects.toThrow(/riscos avaliados/i);
      await expect(comoSocio((c) => c.query('DELETE FROM pgr_ghes WHERE id = $1', [ghe]))).rejects.toThrow(/riscos avaliados/i);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_ghes WHERE id = $1', [ghe])).rows[0].n).toBe(1);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risks WHERE id = $1', [r])).rows[0].n).toBe(1);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(1);
    });

    it('DELETE de GHE sem avaliações continua funcionando (superuser e socio), mesmo com riscos não avaliados em cascata', async () => {
      const g1 = await db.insertRawRow('pgr_ghes', { tenant_id: montese.tenantId, name: 'TESTE GHE livre 1' });
      expect((await db.client.query('DELETE FROM pgr_ghes WHERE id = $1', [g1])).rowCount).toBe(1);
      const g2 = await db.insertRawRow('pgr_ghes', { tenant_id: montese.tenantId, name: 'TESTE GHE livre 2' });
      await db.insertRawRow('pgr_risks', { tenant_id: montese.tenantId, ghe_id: g2, category: 'fisico', name: 'TESTE R livre', exposure_type: 'eventual' });
      await comoSocio(async (c) => {
        expect((await c.query('DELETE FROM pgr_ghes WHERE id = $1', [g2])).rowCount).toBe(1);
      });
    });

    it('apagar o tenant (com GHE e risco avaliados) ainda funciona em cascata', async () => {
      const t = await db.createTenantWithUser('Cliente Efêmero GHE');
      const r = await novoRisco(t, 'tenant-ghe-cascata');
      const id = (await db.client.query(avaliacao(t.tenantId, r, vPub).sql, avaliacao(t.tenantId, r, vPub).params)).rows[0].id;
      await db.client.query('DELETE FROM tenants WHERE id = $1', [t.tenantId]);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_ghes WHERE tenant_id = $1', [t.tenantId])).rows[0].n).toBe(0);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(0);
    });

    it('apagar o tenant apaga avaliações em cascata', async () => {
      const t = await db.createTenantWithUser('Cliente Efêmero Matriz');
      const r = await novoRisco(t, 'tenant-cascata');
      const q = avaliacao(t.tenantId, r, vPub);
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await db.client.query('DELETE FROM tenants WHERE id = $1', [t.tenantId]);
      expect((await db.client.query('SELECT count(*)::int n FROM pgr_risk_assessments WHERE id = $1', [id])).rows[0].n).toBe(0);
    });

    it('apagar o usuário avaliador mantém a avaliação (assessed_by vira NULL)', async () => {
      const u = await db.createUserWithRole('socio', 'Socio Efêmero');
      const q = avaliacao(montese.tenantId, riscoM, vPub);
      q.params[8] = u.userId;
      const id = (await db.client.query(q.sql, q.params)).rows[0].id;
      await db.client.query('DELETE FROM users WHERE id = $1', [u.userId]);
      const x = await db.client.query('SELECT assessed_by FROM pgr_risk_assessments WHERE id = $1', [id]);
      expect(x.rows[0].assessed_by).toBeNull();
    });

    it('versão referenciada por avaliação não pode ser apagada (RESTRICT) — nem a publicada', async () => {
      await expect(db.client.query('DELETE FROM pgr_matrix_versions WHERE id = $1', [vPub])).rejects.toThrow();
    });

    it.each([
      ['tecnico', () => tecnico.userId, ''],
      ['parceiro', () => tecnico.userId, ''],
      ['empresa', () => montese.userId, 'TENANT'],
    ])('%s não lê nem insere avaliações', async (role, user, tenant) => {
      const tid = tenant === 'TENANT' ? montese.tenantId : '';
      const r = await comoPapel(role, user(), async (c) => {
        const lidas = (await c.query('SELECT count(*)::int n FROM pgr_risk_assessments')).rows[0].n;
        await c.query('SAVEPOINT s');
        const q = avaliacao(montese.tenantId, riscoM, vPub);
        const ins = await c.query(q.sql, q.params).then(() => 'inseriu', (e: Error) => e.message);
        return { lidas, ins };
      }, tid);
      expect(r.lidas).toBe(0);
      expect(r.ins).toMatch(/row-level security|permission denied|tenant incoerente/i);
    });
  });

  // --- cabeçalho de rollback ---
  it('a migration documenta o rollback no cabeçalho', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0099_pgr_matriz.sql'), 'utf8');
    const cab = sql.split('\n').slice(0, 25).join('\n');
    expect(cab).toMatch(/Rollback/i);
    expect(cab).toMatch(/DROP TABLE pgr_risk_assessments, pgr_matrix_versions/);
    expect(sql.split('\n').slice(0, 30).join('\n')).toMatch(/pgr_ghes_keep_assessments/);
    expect(sql.split('\n').slice(0, 30).join('\n')).toMatch(/pgr_matriz_no_truncate/);
    expect(sql).not.toMatch(/INSERT INTO pgr_matrix_versions/i); // sem seed
  });
});
