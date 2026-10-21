// Seed de HOMOLOGAÇÃO. Roda DENTRO do container descartável (NODE_PATH=/app/node_modules).
// Dados 100% fictícios. Senhas vêm do ambiente (geradas aleatoriamente fora do repositório) e
// NUNCA são impressas. Nenhum dado profissional real: conselho 'TESTE', números '0001'/'0002'.
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const E = process.env;
const must = (k) => { if (!E[k]) throw new Error(`falta ${k}`); return E[k]; };

(async () => {
  const c = new Client({ connectionString: must('DATABASE_URL') });
  await c.connect();
  const hash = (pw) => bcrypt.hashSync(pw, 4);
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  await c.query('BEGIN');
  const tenant = async (name, cnpj) =>
    (await one("INSERT INTO tenants (name, cnpj, status) VALUES ($1,$2,'ativo') RETURNING id", [name, cnpj])).id;
  const tA = await tenant('Cliente Montese HOM A', '11111111000101');
  const tB = await tenant('Cliente Montese HOM B', '11111111000202');
  const tP = await tenant('Empresa de Parceiro HOM', '11111111000303');

  const user = async (role, email, name, pw, tenantId = null) =>
    (await one(
      "INSERT INTO users (tenant_id, role, email, password_hash, full_name, status) VALUES ($1,$2,$3,$4,$5,'ativo') RETURNING id",
      [tenantId, role, email, hash(pw), name],
    )).id;
  const admin = await user('admin', 'admin.hom@teste.invalid', 'Admin HOM', must('HOM_PW_ADMIN'));
  const socioA = await user('socio', 'socio.a.hom@teste.invalid', 'Sócio HOM A', must('HOM_PW_SOCIOA'));
  const socioB = await user('socio', 'socio.b.hom@teste.invalid', 'Sócio HOM B', must('HOM_PW_SOCIOB'));
  await user('empresa', 'empresa.hom@teste.invalid', 'Empresa HOM A', must('HOM_PW_EMPRESA'), tA);
  const tecU = await user('tecnico', 'tecnico.hom@teste.invalid', 'Técnico HOM', must('HOM_PW_TECNICO'));
  const tec = (await one("INSERT INTO technicians (user_id) VALUES ($1) RETURNING id", [tecU])).id;
  await c.query("INSERT INTO tenant_technicians (tenant_id, technician_id, status) VALUES ($1,$2,'ativo')", [tP, tec]);

  // Financeiro: A em dia; B com pendência (último pagamento rejeitado há 5 dias); parceiro fora da carteira.
  const plan = (await one("SELECT id FROM plans WHERE audience='empresa' ORDER BY price_cents LIMIT 1")).id;
  const sub = async (tenantId, status, pre) =>
    (await one(
      'INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [plan, tenantId, status, pre],
    )).id;
  const pay = (s, id, cents, status, daysAgo) =>
    c.query(
      "INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at) VALUES ($1,$2,$3,$4, now() - make_interval(days => $5::int))",
      [s, id, cents, status, daysAgo],
    );
  const sA = await sub(tA, 'authorized', 'hom-pre-a');
  const sB = await sub(tB, 'authorized', 'hom-pre-b');
  const sP = await sub(tP, 'authorized', 'hom-pre-p');
  await pay(sA, 'hom-pay-a1', 29900, 'approved', 1);
  await pay(sB, 'hom-pay-b1', 29900, 'approved', 35);
  await pay(sB, 'hom-pay-b2', 29900, 'rejected', 5);
  await pay(sP, 'hom-pay-p1', 29900, 'approved', 1);

  // RBAC dos sócios (todas as 14 permissões) — configuração de TESTE.
  const perms = ['clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
    'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve','documents.publish',
    'documents.cancel','documents.view_registration','finance.read'];
  for (const u of [socioA, socioB]) for (const p of perms) {
    await c.query('INSERT INTO socio_permissions (user_id, permission, granted_by) VALUES ($1,$2,$3)', [u, p, admin]);
  }

  // Registros profissionais FICTÍCIOS e confirmados (somente para homologação).
  const reg = async (u, num) => {
    // O banco exige o fluxo real: o registro nasce pendente e a confirmação é uma etapa separada.
    const r = await one("INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by) VALUES ($1,'TESTE',$2,'SP',$3) RETURNING id", [u, num, admin]);
    await c.query("UPDATE professional_registrations SET status='confirmado', confirmed_by=$2, confirmed_at=now() WHERE id=$1", [r.id, admin]);
  };
  await reg(socioA, '0001');
  await reg(socioB, '0002');

  // Matriz de TESTE só para 'pgr': A elabora/revisa; B revisa/aprova/assina/publica. 'laudo' fica vazia de propósito.
  const mat = async (u, acts) => { for (const a of acts) await c.query('INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ($1,$2,$3,$4)', ['pgr', u, a, admin]); };
  await mat(socioA, ['elaborar', 'revisar']);
  await mat(socioB, ['revisar', 'aprovar', 'assinar', 'publicar']);

  await c.query('COMMIT');
  console.log('seed de homologação aplicado');
  await c.end();
})().catch((e) => { console.error('seed falhou:', e.message); process.exit(1); });
