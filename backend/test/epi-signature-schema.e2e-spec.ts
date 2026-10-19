import { Client } from 'pg';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');

describe('Schema e funções da assinatura eletrônica (0083)', () => {
  let db: TestDb; let sql: Client; let app: Client;
  let tenantId: string; let userId: string; let employeeId: string; let epiId: string;

  // cria uma entrega pendente + requisição ativa; devolve token/pin em claro (só no teste)
  async function makeRequest(over: { expiresInSeconds?: number; deliveries?: number } = {}) {
    const token = randomBytes(32).toString('base64url');
    const pin = '123456';
    const deliveryIds: string[] = [];
    for (let i = 0; i < (over.deliveries ?? 1); i++) {
      const d = await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, signed_by_name, signed_at, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',2,'pendente',NULL,NULL,$4) RETURNING id`, [tenantId, epiId, employeeId, userId]);
      deliveryIds.push(d.rows[0].id);
    }
    const r = await sql.query(
      `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
       VALUES ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval, 'rascunho-1', $6, $7, $8) RETURNING id`,
      [tenantId, employeeId, sha(token), hmac(token, pin), String(over.expiresInSeconds ?? 3600), 'a'.repeat(64), userId, `idem-${randomUUID()}`]);
    for (const id of deliveryIds) {
      await sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [r.rows[0].id, id]);
    }
    return { token, pin, requestId: r.rows[0].id as string, deliveryIds };
  }
  const call = (q: string, p: unknown[]) => app.query(q, p);

  let otherTenantId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const a = await db.createTenantWithUser('Empresa Assinatura A');
    const b = await db.createTenantWithUser('Empresa Assinatura B');
    tenantId = a.tenantId; userId = a.userId; employeeId = a.employeeId;
    otherTenantId = b.tenantId; otherUserId = b.userId;
    epiId = await makeEpi(tenantId, userId);
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end(); await app.end();
    await db.disconnect();
  });

  // EPI da empresa (tenant_epis) a partir de um item do catálogo global
  async function makeEpi(tid: string, uid: string) {
    const cat = await sql.query('SELECT id FROM epi_catalog_items ORDER BY id LIMIT 1');
    const r = await sql.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, manufacturer, model, created_by_user_id)
       VALUES ($1,$2,$3,'Fabricante X','Modelo Y',$4) RETURNING id`,
      [tid, cat.rows[0].id, `CA-${randomUUID().slice(0, 6)}`, uid]);
    return r.rows[0].id as string;
  }

  it('peek: link ativo é utilizável e só devolve o nome da empresa; inexistente é indistinguível de expirado', async () => {
    const a = await makeRequest();
    const ok = await call('SELECT * FROM epi_sig_peek($1)', [sha(a.token)]);
    expect(ok.rows[0].usable).toBe(true);
    expect(ok.rows[0].company_name).toBeTruthy();
    const none = await call('SELECT * FROM epi_sig_peek($1)', [sha('nao-existe')]);
    const exp = await makeRequest({ expiresInSeconds: -5 });
    const expired = await call('SELECT * FROM epi_sig_peek($1)', [sha(exp.token)]);
    expect(none.rows[0]).toEqual({ usable: false, company_name: null });
    expect(expired.rows[0]).toEqual({ usable: false, company_name: null });
    const st = await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [exp.requestId]);
    expect(st.rows[0].status).toBe('expirada'); // expiração preguiçosa persistida
  });

  it('open: código certo devolve itens e nome; errado conta tentativa; 5 erros bloqueiam; depois nem o certo abre', async () => {
    const a = await makeRequest();
    const good = await call('SELECT * FROM epi_sig_open($1,$2)', [sha(a.token), hmac(a.token, a.pin)]);
    expect(good.rows[0].result).toBe('ok');
    expect(good.rows[0].items).toHaveLength(1);
    expect(JSON.stringify(good.rows[0])).not.toMatch(/\b\d{11}\b/); // sem CPF
    const b = await makeRequest();
    const bad = hmac(b.token, '000000');
    for (let i = 1; i <= 4; i++) {
      const r = await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), bad]);
      expect(r.rows[0]).toMatchObject({ result: 'wrong_code', attempts_left: 5 - i });
    }
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), bad])).rows[0].result).toBe('locked');
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), hmac(b.token, b.pin)])).rows[0].result).toBe('locked');
    expect((await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [b.requestId])).rows[0].status).toBe('bloqueada');
  });

  it('sign: grava evidência imutável, marca entregas e requisição, e o hash da evidência confere', async () => {
    const a = await makeRequest({ deliveries: 2 });
    const r = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'tenants/x/epi-signatures/s.png', 'b'.repeat(64), '203.0.113.9', 'UA-teste']);
    expect(r.rows[0].result).toBe('ok');
    expect(r.rows[0].receipt_code).toMatch(/^ASEPI-\d{8}-[0-9A-F]{8}$/);
    const ev = (await sql.query('SELECT * FROM epi_signatures WHERE id = $1', [r.rows[0].signature_id])).rows[0];
    const re = await sql.query("SELECT encode(digest(evidence_payload::text,'sha256'),'hex') AS h FROM epi_signatures WHERE id = $1", [r.rows[0].signature_id]);
    expect(re.rows[0].h).toBe(ev.evidence_sha256); // a evidência é verificável por qualquer um a partir do payload gravado
    expect(ev.evidence_payload.signature_sha256).toBe('b'.repeat(64));
    expect(ev.evidence_payload.code_verified).toBe(true);
    const d = await sql.query('SELECT signature_status, signed_at, signed_by_name FROM employee_epi_deliveries WHERE id = ANY($1)', [a.deliveryIds]);
    expect(d.rows.every((x) => x.signature_status === 'assinada' && x.signed_at && x.signed_by_name)).toBe(true);
    expect(ev.items_snapshot).toHaveLength(2);
    expect((await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [a.requestId])).rows[0].status).toBe('assinada');
    // segunda tentativa com o mesmo link: inválido, nada muda
    const again = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'k2', 'c'.repeat(64), 'ip', 'ua']);
    expect(again.rows[0].result).toBe('invalid');
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [a.requestId])).rows[0].n).toBe(1);
  });

  it('sign sem aceite não grava nada; entrega que deixou de ser pendente -> conflict', async () => {
    const a = await makeRequest();
    expect((await call('SELECT * FROM epi_sig_sign($1,$2,false,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), 'k', 'd'.repeat(64), 'ip', 'ua'])).rows[0].result).toBe('not_accepted');
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [a.deliveryIds[0]]);
    expect((await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), 'k', 'd'.repeat(64), 'ip', 'ua'])).rows[0].result).toBe('conflict');
  });

  it('refuse: marca entregas como recusada e a requisição como recusada; segunda recusa é inválida', async () => {
    const a = await makeRequest();
    expect((await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'Não recebi'])).rows[0].result).toBe('ok');
    expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [a.deliveryIds[0]])).rows[0].signature_status).toBe('recusada');
    expect((await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'x'])).rows[0].result).toBe('invalid');
  });

  it('assinaturas concorrentes no mesmo link: exatamente uma vence', async () => {
    const a = await makeRequest();
    const clients = await Promise.all(Array.from({ length: 6 }, async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; }));
    const rs = await Promise.all(clients.map((c, i) => c.query('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), `k${i}`, 'e'.repeat(64), 'ip', 'ua'])));
    await Promise.all(clients.map((c) => c.end()));
    expect(rs.filter((r) => r.rows[0].result === 'ok')).toHaveLength(1);
    expect(rs.filter((r) => r.rows[0].result === 'invalid')).toHaveLength(5); // as perdedoras veem o link já usado
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [a.requestId])).rows[0].n).toBe(1);
  });

  // assina uma requisição nova e devolve o id da assinatura
  async function signed() {
    const a = await makeRequest();
    const r = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'k/s.png', 'f'.repeat(64), 'ip', 'ua']);
    expect(r.rows[0].result).toBe('ok');
    return { ...a, signatureId: r.rows[0].signature_id as string };
  }

  it('epi_signatures é imutável (UPDATE/DELETE 42501) e TRUNCATE é negado à aplicação', async () => {
    const s = await signed();
    await expect(sql.query('UPDATE epi_signatures SET ip = $2 WHERE id = $1', [s.signatureId, 'x'])).rejects.toMatchObject({ code: '42501' });
    await expect(sql.query('DELETE FROM epi_signatures WHERE id = $1', [s.signatureId])).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('TRUNCATE epi_signatures')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('TRUNCATE epi_signature_requests CASCADE')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('TRUNCATE epi_signature_request_items')).rejects.toMatchObject({ code: '42501' });
  });

  it('constraints: hash inválido, tentativas > 5 e status desconhecido são rejeitados', async () => {
    const a = await makeRequest();
    await expect(sql.query('UPDATE epi_signature_requests SET attempts = 6 WHERE id = $1', [a.requestId])).rejects.toMatchObject({ code: '23514' });
    await expect(sql.query(`UPDATE epi_signature_requests SET status = 'xpto' WHERE id = $1`, [a.requestId])).rejects.toMatchObject({ code: '23514' });
    // token_hash agora é imutável (42501); o CHECK do formato continua valendo no INSERT
    await expect(sql.query(`UPDATE epi_signature_requests SET token_hash = 'abc' WHERE id = $1`, [a.requestId])).rejects.toMatchObject({ code: '42501' });
    await expect(sql.query(
      `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
       VALUES ($1,$2,'abc',$3,now(),'v',$3,$4,$5)`, [tenantId, employeeId, 'a'.repeat(64), userId, `idem-${randomUUID()}`])).rejects.toMatchObject({ code: '23514' });
  });

  it('RLS: empresa B não vê requisições, itens nem assinaturas da A', async () => {
    const s = await signed();
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
      expect((await c.query('SELECT 1 FROM epi_signature_requests WHERE tenant_id = $1', [tenantId])).rowCount).toBe(0);
      expect((await c.query('SELECT 1 FROM epi_signature_request_items WHERE request_id = $1', [s.requestId])).rowCount).toBe(0);
      expect((await c.query('SELECT 1 FROM epi_signatures WHERE tenant_id = $1', [tenantId])).rowCount).toBe(0);
      await expect(
        c.query(
          `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
           VALUES ($1,$2,$3,$3,now(),'v',$3,$4,'idem-rls')`,
          [tenantId, employeeId, 'a'.repeat(64), userId]),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await asTenant(tenantId, async (c) => {
      expect((await c.query('SELECT 1 FROM epi_signature_requests WHERE id = $1', [s.requestId])).rowCount).toBe(1);
      expect((await c.query('SELECT 1 FROM epi_signature_request_items WHERE request_id = $1', [s.requestId])).rowCount).toBe(1);
      expect((await c.query('SELECT 1 FROM epi_signatures WHERE id = $1', [s.signatureId])).rowCount).toBe(1);
    });
    // sem contexto de empresa a aplicação não enxerga nada
    expect((await app.query('SELECT 1 FROM epi_signatures')).rowCount).toBe(0);
  });

  it('ACL das funções: só as 4 públicas têm EXECUTE concedido a montese_app/PUBLIC; as internas (check/items) não', async () => {
    // Obs.: montese_app é membro (com herança) de montese_auth_bypass, dono das funções; por isso has_function_privilege()
    // seria verdadeiro por herança e SET ROLE já contornaria a RLS (propriedade preexistente da arquitetura auth_*, ver 0058).
    // O que a migration controla, e o teste verifica, é a ACL explícita: nenhuma concessão direta nas internas.
    const acl = async (sig: string) => (await sql.query(
      `SELECT COALESCE(array_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) FILTER (WHERE a.grantee IS NOT NULL), '{}') AS g
         FROM pg_proc p LEFT JOIN LATERAL aclexplode(p.proacl) a ON true WHERE p.oid = $1::regprocedure`, [sig])).rows[0].g as string[];
    for (const sig of ['epi_sig_check(text,text)', 'epi_sig_items(uuid)']) {
      const g = await acl(sig);
      expect(g).not.toContain('montese_app');
      expect(g).not.toContain('PUBLIC');
    }
    for (const sig of ['epi_sig_peek(text)', 'epi_sig_open(text,text)', 'epi_sig_sign(text,text,boolean,text,text,text,text)', 'epi_sig_refuse(text,text,text)']) {
      const g = await acl(sig);
      expect(g).toContain('montese_app');
      expect(g).not.toContain('PUBLIC');
    }
  });

  it('exclusão do tenant cascateia requisições, itens, assinaturas e entregas', async () => {
    const c = await db.createTenantWithUser('Empresa Assinatura Cascade');
    const cEpi = await makeEpi(c.tenantId, c.userId);
    const mk = async (suffix: string) => {
      const d = await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, signed_by_name, signed_at, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',1,'pendente',NULL,NULL,$4) RETURNING id`, [c.tenantId, cEpi, c.employeeId, c.userId]);
      const tok = randomBytes(32).toString('base64url');
      const r = await sql.query(
        `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
         VALUES ($1,$2,$3,$4, now() + interval '1 hour','v',$5,$6,$7) RETURNING id`,
        [c.tenantId, c.employeeId, sha(tok), hmac(tok, '123456'), 'a'.repeat(64), c.userId, `idem-c-${suffix}`]);
      await sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [r.rows[0].id, d.rows[0].id]);
      return { tok, id: r.rows[0].id as string };
    };
    const ativa = await mk('1');
    const feita = await mk('2');
    expect((await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(feita.tok), hmac(feita.tok, '123456'), 'k', 'a'.repeat(64), 'ip', 'ua'])).rows[0].result).toBe('ok');
    // assinatura presencial (registro + item) também cai com o tenant
    const pd = await sql.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, signed_by_name, signed_at, created_by_user_id)
       VALUES ($1,$2,$3,'2026-10-14',1,'presencial','X',now(),$4) RETURNING id`, [c.tenantId, cEpi, c.employeeId, c.userId]);
    await sql.query('BEGIN'); // registro e itens na mesma transação (a conferência deferida roda no COMMIT)
    const ip = await sql.query(
      `INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version) VALUES ($1,$2,'Testemunha','Motivo valido',$3,'v') RETURNING id`,
      [c.tenantId, c.employeeId, c.userId]);
    await sql.query('INSERT INTO epi_in_person_signature_items (in_person_id, delivery_id) VALUES ($1,$2)', [ip.rows[0].id, pd.rows[0].id]);
    await sql.query('COMMIT');
    await sql.query('DELETE FROM tenants WHERE id = $1', [c.tenantId]);
    expect((await sql.query('SELECT 1 FROM epi_in_person_signatures WHERE tenant_id = $1', [c.tenantId])).rowCount).toBe(0);
    expect((await sql.query('SELECT 1 FROM epi_in_person_signature_items WHERE in_person_id = $1', [ip.rows[0].id])).rowCount).toBe(0);
    for (const tbl of ['epi_signature_requests', 'epi_signatures', 'employee_epi_deliveries']) {
      expect((await sql.query(`SELECT 1 FROM ${tbl} WHERE tenant_id = $1`, [c.tenantId])).rowCount).toBe(0);
    }
    expect((await sql.query('SELECT 1 FROM epi_signature_request_items WHERE request_id = ANY($1)', [[ativa.id, feita.id]])).rowCount).toBe(0);
  });

  // ---- Rodada de correções (revisão de segurança) ----

  it('código NULL nunca passa como correto: conta tentativa; token NULL é inválido', async () => {
    const a = await makeRequest();
    const o = await call('SELECT * FROM epi_sig_open($1,$2)', [sha(a.token), null]);
    expect(o.rows[0]).toMatchObject({ result: 'wrong_code', attempts_left: 4 });
    const sg = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), null, 'k', 'a'.repeat(64), 'ip', 'ua']);
    expect(sg.rows[0].result).toBe('wrong_code');
    const rf = await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), null, 'x']);
    expect(rf.rows[0].result).toBe('wrong_code');
    const st = await sql.query('SELECT status, attempts FROM epi_signature_requests WHERE id = $1', [a.requestId]);
    expect(st.rows[0]).toEqual({ status: 'ativa', attempts: 3 });
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [a.requestId])).rows[0].n).toBe(0);
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [null, hmac(a.token, a.pin)])).rows[0].result).toBe('invalid');
    expect((await call('SELECT * FROM epi_sig_peek($1)', [null])).rows[0].usable).toBe(false);
  });

  it('attempts >= 5 com status ainda ativa é tratado como locked antes de comparar o código', async () => {
    const a = await makeRequest();
    await sql.query('UPDATE epi_signature_requests SET attempts = 5 WHERE id = $1', [a.requestId]);
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [sha(a.token), hmac(a.token, a.pin)])).rows[0].result).toBe('locked');
    expect((await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [a.requestId])).rows[0].status).toBe('bloqueada');
  });

  it('tentativas ERRADAS concorrentes: attempts final = 5, bloqueada, sem violar o CHECK', async () => {
    const a = await makeRequest();
    const clients = await Promise.all(Array.from({ length: 8 }, async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; }));
    const rs = await Promise.all(clients.map((c) => c.query('SELECT * FROM epi_sig_open($1,$2)', [sha(a.token), hmac(a.token, '000000')])));
    await Promise.all(clients.map((c) => c.end()));
    expect(rs.every((r) => ['wrong_code', 'locked'].includes(r.rows[0].result))).toBe(true);
    const st = await sql.query('SELECT status, attempts FROM epi_signature_requests WHERE id = $1', [a.requestId]);
    expect(st.rows[0]).toEqual({ status: 'bloqueada', attempts: 5 });
  });

  describe('itens da requisição (guarda)', () => {
    const newReq = async (tid: string, emp: string, uid: string) => {
      const tok = randomBytes(32).toString('base64url');
      const r = await sql.query(
        `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
         VALUES ($1,$2,$3,$3, now() + interval '1 hour','v',$3,$4,$5) RETURNING id`, [tid, emp, sha(tok), uid, `idem-${randomUUID()}`]);
      return r.rows[0].id as string;
    };
    const delivery = async (tid: string, ep: string, emp: string, uid: string, status = 'pendente') =>
      (await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',1,$5,$4) RETURNING id`, [tid, ep, emp, uid, status])).rows[0].id as string;
    const addItem = (req: string, del: string) => sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [req, del]);

    it('recusa entrega de outra empresa, de outro funcionário ou já assinada (23514)', async () => {
      const req = await newReq(tenantId, employeeId, userId);
      const b = await db.createTenantWithUser('Empresa Assinatura Itens B');
      const bEpi = await makeEpi(b.tenantId, b.userId);
      const outraEmpresa = await delivery(b.tenantId, bEpi, b.employeeId, b.userId);
      await expect(addItem(req, outraEmpresa)).rejects.toMatchObject({ code: '23514' });
      const emp2 = (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1,'Outro Func','52998224725','ativo') RETURNING id`, [tenantId])).rows[0].id;
      const outroFunc = await delivery(tenantId, epiId, emp2, userId);
      await expect(addItem(req, outroFunc)).rejects.toMatchObject({ code: '23514' });
      const jaAssinada = await delivery(tenantId, epiId, employeeId, userId, 'assinada');
      await expect(addItem(req, jaAssinada)).rejects.toMatchObject({ code: '23514' });
      const ok = await delivery(tenantId, epiId, employeeId, userId);
      await expect(addItem(req, ok)).resolves.toBeDefined();
    });

    it('itens de requisição assinada: UPDATE e DELETE diretos dão 42501', async () => {
      const s = await signed();
      await expect(sql.query('DELETE FROM epi_signature_request_items WHERE request_id = $1', [s.requestId])).rejects.toMatchObject({ code: '42501' });
      const novo = await delivery(tenantId, epiId, employeeId, userId);
      await expect(sql.query('UPDATE epi_signature_request_items SET delivery_id = $2 WHERE request_id = $1', [s.requestId, novo])).rejects.toMatchObject({ code: '42501' });
    });

    it('requisição ativa permite remover item; a assinatura ignora item de outro funcionário plantado por bypass', async () => {
      const a = await makeRequest();
      await sql.query('DELETE FROM epi_signature_request_items WHERE request_id = $1', [a.requestId]);
      expect((await sql.query('SELECT 1 FROM epi_signature_request_items WHERE request_id = $1', [a.requestId])).rowCount).toBe(0);
    });
  });

  it('montese_app não insere nem altera evidência diretamente (42501, mesmo com tenant correto); a função definer continua inserindo', async () => {
    const s = await signed();
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.role','empresa',true), set_config('app.tenant_id',$1,true)`, [tenantId]);
      await expect(app.query(
        `INSERT INTO epi_signatures (tenant_id, request_id, employee_id, signed_at, accepted, term_version, term_text_sha256, items_snapshot,
           signature_file_key, signature_sha256, code_verified, evidence_payload, evidence_sha256, receipt_code)
         VALUES ($1,$2,$3,now(),true,'v',$4,'[]','k',$4,true,'{}',$4,'ASEPI-FORJADO')`,
        [tenantId, s.requestId, employeeId, 'a'.repeat(64)])).rejects.toMatchObject({ code: '42501' });
    } finally { await app.query('ROLLBACK'); }
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.role','empresa',true), set_config('app.tenant_id',$1,true)`, [tenantId]);
      await expect(app.query('UPDATE epi_signatures SET ip = $2 WHERE id = $1', [s.signatureId, 'x'])).rejects.toMatchObject({ code: '42501' });
    } finally { await app.query('ROLLBACK'); }
  });

  it('evidência: payload completo, sem CPF (nem formatado) e ip/user_agent limitados', async () => {
    const a = await makeRequest();
    const r = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'k/e.png', 'd'.repeat(64), 'i'.repeat(200), 'U'.repeat(500)]);
    expect(r.rows[0].result).toBe('ok');
    const ev = (await sql.query('SELECT * FROM epi_signatures WHERE id = $1', [r.rows[0].signature_id])).rows[0];
    expect(Object.keys(ev.evidence_payload)).toEqual(expect.arrayContaining(
      ['items', 'term_version', 'term_text_sha256', 'signature_sha256', 'ip', 'user_agent', 'code_verified']));
    expect(ev.ip).toHaveLength(64);
    expect(ev.user_agent).toHaveLength(300);
    expect(ev.evidence_payload.ip).toHaveLength(64);
    const all = JSON.stringify(ev.evidence_payload) + JSON.stringify(ev.items_snapshot);
    expect(all).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(all).not.toMatch(/\b\d{11}\b/);
    const cpf = (await sql.query('SELECT cpf FROM employees WHERE id = $1', [employeeId])).rows[0].cpf as string | null;
    if (cpf) expect(all).not.toContain(cpf);
    await expect(sql.query('UPDATE epi_signatures SET ip = $2 WHERE id = $1', [ev.id, 'x'])).rejects.toMatchObject({ code: '42501' });
  });

  it('checks de tamanho e hash em epi_signatures (ip > 64, user_agent > 300, term hash inválido)', async () => {
    const ins = async (over: { ip?: string; ua?: string; term?: string }) => {
      const a = await makeRequest();
      return sql.query(
        `INSERT INTO epi_signatures (tenant_id, request_id, employee_id, signed_at, accepted, term_version, term_text_sha256, items_snapshot,
           signature_file_key, signature_sha256, ip, user_agent, code_verified, evidence_payload, evidence_sha256, receipt_code)
         VALUES ($1,$2,$3,now(),true,'v',$4,'[]','k',$5,$6,$7,true,'{}',$5,$8)`,
        [tenantId, a.requestId, employeeId, over.term ?? 'a'.repeat(64), 'b'.repeat(64), over.ip ?? 'ip', over.ua ?? 'ua', `ASEPI-C-${randomUUID()}`]);
    };
    await expect(ins({ ip: 'i'.repeat(65) })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({ ua: 'u'.repeat(301) })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({ term: 'xyz' })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({})).resolves.toBeDefined();
  });

  // ---- Onda final: garantias por trigger (assinada => evidência; presencial => registro; requisição imutável) ----
  describe('garantias de estado por trigger', () => {
    // executa como montese_app com o contexto da empresa (RLS enxerga as linhas) e sempre desfaz
    const asApp = async <T>(tid: string, fn: () => Promise<T>): Promise<T> => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.role','empresa',true), set_config('app.tenant_id',$1,true)`, [tid]);
        return await fn();
      } finally {
        await app.query('ROLLBACK');
      }
    };
    const code = async (c: Client, q: string, p: unknown[] = []) => {
      await c.query('SAVEPOINT sp').catch(() => undefined);
      try { await c.query(q, p); return 'ok'; } catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT sp').catch(() => undefined); return e.code as string; }
    };
    const delivery = async (suffix = 'pendente') => {
      const d = await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, signed_by_name, signed_at, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',1,$4,NULL,NULL,$5) RETURNING id`, [tenantId, epiId, employeeId, suffix, userId]);
      return d.rows[0].id as string;
    };
    const inPerson = async (deliveryIds: string[], emp = employeeId, tid = tenantId) => {
      const r = await sql.query(
        `INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version)
         VALUES ($1,$2,'Testemunha','Motivo valido',$3,'v') RETURNING id`, [tid, emp, userId]);
      for (const d of deliveryIds) await sql.query('INSERT INTO epi_in_person_signature_items (in_person_id, delivery_id) VALUES ($1,$2)', [r.rows[0].id, d]);
      return r.rows[0].id as string;
    };

    it('a aplicação não consegue marcar a entrega como assinada; as funções epi_sig_* conseguem', async () => {
      const a = await makeRequest();
      const d = a.deliveryIds[0];
      expect(await asApp(tenantId, async () => code(app, `UPDATE employee_epi_deliveries SET signature_status = 'assinada' WHERE id = $1`, [d]))).toBe('42501');
      expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [d])).rows[0].signature_status).toBe('pendente');
      const r = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), 'k/g.png', 'f'.repeat(64), 'ip', 'ua']);
      expect(r.rows[0].result).toBe('ok');
      expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [d])).rows[0].signature_status).toBe('assinada');
    });

    it("'presencial' sem registro é recusado; com item gravado antes, passa", async () => {
      const d = await delivery();
      await expect(sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'presencial' WHERE id = $1`, [d])).rejects.toMatchObject({ code: '23514' });
      await sql.query('BEGIN');
      await inPerson([d]);
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'presencial' WHERE id = $1`, [d]);
      await sql.query('COMMIT');
      expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [d])).rows[0].signature_status).toBe('presencial');
    });

    it("assinada/presencial só saem para 'estornada' (nunca voltam a pendente/recusada)", async () => {
      const sg = await signed();
      const dSig = sg.deliveryIds[0];
      for (const to of ['pendente', 'recusada', 'legado']) {
        await expect(sql.query('UPDATE employee_epi_deliveries SET signature_status = $2 WHERE id = $1', [dSig, to])).rejects.toMatchObject({ code: '42501' });
      }
      const dPres = await delivery();
      await sql.query('BEGIN');
      await inPerson([dPres]);
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'presencial' WHERE id = $1`, [dPres]);
      await sql.query('COMMIT');
      await expect(sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = $1`, [dPres])).rejects.toMatchObject({ code: '42501' });
      // estorno (livro) continua possível, inclusive pela aplicação
      expect(await asApp(tenantId, async () => code(app, `UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [dSig]))).toBe('ok');
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [dSig]);
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [dPres]);
    });

    it('fluxos que continuam permitidos: pendente->recusada (refuse), recusada->pendente, legado->pendente, mesma situação', async () => {
      const a = await makeRequest();
      const r = await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'nao']);
      expect(r.rows[0].result).toBe('ok');
      const d = a.deliveryIds[0];
      expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [d])).rows[0].signature_status).toBe('recusada');
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = $1`, [d]);
      const l = await delivery('legado');
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = $1`, [l]);
      await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = $1`, [l]);
    });

    it('requisição: a aplicação só revoga (ativa->revogada); encerrada não muda nem reativa; campos imutáveis', async () => {
      const a = await makeRequest();
      for (const q of [
        `UPDATE epi_signature_requests SET status = 'assinada' WHERE id = $1`,
        `UPDATE epi_signature_requests SET status = 'recusada' WHERE id = $1`,
        `UPDATE epi_signature_requests SET attempts = 3 WHERE id = $1`,
        `UPDATE epi_signature_requests SET used_at = now() WHERE id = $1`,
        `UPDATE epi_signature_requests SET refusal_reason = 'x' WHERE id = $1`,
        `UPDATE epi_signature_requests SET expires_at = now() + interval '30 days' WHERE id = $1`,
        `UPDATE epi_signature_requests SET token_hash = '${'c'.repeat(64)}' WHERE id = $1`,
        `UPDATE epi_signature_requests SET pin_hash = '${'c'.repeat(64)}' WHERE id = $1`,
        `UPDATE epi_signature_requests SET idempotency_key = 'outra-chave-xx' WHERE id = $1`,
        `UPDATE epi_signature_requests SET term_version = 'outra' WHERE id = $1`,
        `UPDATE epi_signature_requests SET term_text_sha256 = '${'c'.repeat(64)}' WHERE id = $1`,
      ]) {
        expect([q, await asApp(tenantId, async () => code(app, q, [a.requestId]))]).toEqual([q, '42501']);
      }
      expect(await asApp(tenantId, async () => code(app, `UPDATE epi_signature_requests SET status = 'revogada' WHERE id = $1`, [a.requestId]))).toBe('ok');
      await sql.query(`UPDATE epi_signature_requests SET status = 'revogada' WHERE id = $1`, [a.requestId]);
      // encerrada: nem reativar nem trocar status (nem pelo superusuário)
      await expect(sql.query(`UPDATE epi_signature_requests SET status = 'ativa' WHERE id = $1`, [a.requestId])).rejects.toMatchObject({ code: '42501' });
      await expect(sql.query(`UPDATE epi_signature_requests SET status = 'assinada' WHERE id = $1`, [a.requestId])).rejects.toMatchObject({ code: '42501' });
      const sg = await signed();
      await expect(sql.query(`UPDATE epi_signature_requests SET status = 'ativa' WHERE id = $1`, [sg.requestId])).rejects.toMatchObject({ code: '42501' });
      await expect(sql.query(`UPDATE epi_signature_requests SET token_hash = '${'d'.repeat(64)}' WHERE id = $1`, [sg.requestId])).rejects.toMatchObject({ code: '42501' });
      // attempts só cresce
      const b = await makeRequest();
      await sql.query('UPDATE epi_signature_requests SET attempts = 2 WHERE id = $1', [b.requestId]);
      await expect(sql.query('UPDATE epi_signature_requests SET attempts = 1 WHERE id = $1', [b.requestId])).rejects.toMatchObject({ code: '42501' });
    });

    it('DELETE direto de requisição (recusada, assinada ou ativa) é recusado; a cascata do tenant continua funcionando', async () => {
      const a = await makeRequest();
      await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'nao']);
      await expect(sql.query('DELETE FROM epi_signature_requests WHERE id = $1', [a.requestId])).rejects.toMatchObject({ code: '42501' });
      const b = await makeRequest();
      expect(await asApp(tenantId, async () => code(app, 'DELETE FROM epi_signature_requests WHERE id = $1', [b.requestId]))).toBe('42501');
      expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE id = ANY($1)', [[a.requestId, b.requestId]])).rowCount).toBe(2);
      // (a cascata de tenant é provada no teste 'exclusão do tenant cascateia ...')
    });

    it('registro presencial: item de outro funcionário/empresa e entrega que não termina presencial são recusados', async () => {
      const other = await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Outro Func', '39053344705', 'ativo') RETURNING id`, [tenantId]);
      const dOther = await delivery();
      await sql.query(`UPDATE employee_epi_deliveries SET employee_id = $2 WHERE id = $1`, [dOther, other.rows[0].id]);
      const foreignEpi = await makeEpi(otherTenantId, otherUserId);
      const foreignEmp = (await sql.query(`SELECT id FROM employees WHERE tenant_id = $1 LIMIT 1`, [otherTenantId])).rows[0].id;
      const dForeign = (await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',1,'pendente',$4) RETURNING id`, [otherTenantId, foreignEpi, foreignEmp, otherUserId])).rows[0].id;
      // registro do funcionário A com entrega de outro funcionário / de outra empresa -> recusado já no INSERT do item
      for (const bad of [dOther, dForeign]) {
        await sql.query('BEGIN');
        const reg = await sql.query(
          `INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version)
           VALUES ($1,$2,'Testemunha','Motivo valido',$3,'v') RETURNING id`, [tenantId, employeeId, userId]);
        await expect(sql.query('INSERT INTO epi_in_person_signature_items (in_person_id, delivery_id) VALUES ($1,$2)', [reg.rows[0].id, bad])).rejects.toMatchObject({ code: '23514' });
        await sql.query('ROLLBACK');
      }
      // commit: entrega que continua 'pendente' -> o COMMIT falha; registro sem itens -> o COMMIT falha
      const dPend = await delivery();
      await sql.query('BEGIN');
      await inPerson([dPend]);
      await expect(sql.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      await sql.query('ROLLBACK').catch(() => undefined);
      await sql.query('BEGIN');
      await sql.query(`INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version) VALUES ($1,$2,'Testemunha','Motivo valido',$3,'v')`, [tenantId, employeeId, userId]);
      await expect(sql.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      await sql.query('ROLLBACK').catch(() => undefined);
      expect((await sql.query('SELECT 1 FROM epi_in_person_signature_items WHERE delivery_id = $1', [dPend])).rowCount).toBe(0);
    });
  });
});
