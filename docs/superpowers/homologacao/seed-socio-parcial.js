// Cria o sócio de TESTE C (socio.c.hom@teste.invalid) com APENAS clients.read, para exercitar
// permission.denied. Senha vem de HOM_PW_SOCIOC (aleatória, fora do repositório); nunca é impressa.
const { Client } = require('pg');
const bcrypt = require('bcrypt');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const admin = (await c.query("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1")).rows[0].id;
  const exist = await c.query("SELECT id FROM users WHERE email='socio.c.hom@teste.invalid'");
  if (exist.rowCount) { console.log('socio C já existe'); return c.end(); }
  const u = (await c.query("INSERT INTO users (role, email, password_hash, full_name, status) VALUES ('socio','socio.c.hom@teste.invalid',$1,'Sócio HOM C (parcial)','ativo') RETURNING id", [bcrypt.hashSync(process.env.HOM_PW_SOCIOC, 4)])).rows[0].id;
  await c.query("INSERT INTO socio_permissions (user_id, permission, granted_by) VALUES ($1,'clients.read',$2)", [u, admin]);
  console.log('socio C criado com clients.read');
  await c.end();
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
