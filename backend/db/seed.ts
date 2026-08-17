import { Client } from 'pg';
import * as bcrypt from 'bcrypt';

// Dados de demonstração idempotentes (ON CONFLICT sempre por chave natural:
// cnpj, email, user_id, ou tenant_id+cpf) — roda quantas vezes for preciso
// sem duplicar nada. Todo identificador criado aqui usa o domínio
// @seed.montese.local e CNPJs/CPFs na faixa 100000000000xx, para nunca
// colidir com dados reais nem com os registros manuais legados (Empresa A,
// Empresa B, Empresa Login Teste — criados via psql em sessões anteriores,
// ver docs/roadmap.md). Este script não apaga nem altera esses registros
// legados; eles continuam pendentes de limpeza manual à parte.
const SEED_PASSWORD = 'Seed@Montese123';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Seed bloqueado: NODE_ENV=production. Este script cria usuários com ' +
        'senha conhecida publicamente — nunca rodar em produção.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    // Mesmo mecanismo que o TenantContextInterceptor usa numa requisição
    // autenticada como admin (SET LOCAL app.role) — não é um bypass
    // especial, é o script "logado" como admin pelo tempo da transação.
    await client.query("SELECT set_config('app.role', 'admin', true)");

    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

    const tenantA = await upsertTenant(client, 'Empresa Demo A (seed)', '10000000000011');
    const tenantB = await upsertTenant(client, 'Empresa Demo B (seed)', '10000000000012');

    await upsertUser(client, tenantA, 'empresa', 'rh-a@seed.montese.local', 'RH Empresa Demo A', passwordHash);
    await upsertUser(client, tenantB, 'empresa', 'rh-b@seed.montese.local', 'RH Empresa Demo B', passwordHash);

    const technicianUserId = await upsertUser(
      client,
      null,
      'tecnico',
      'tecnico.demo@seed.montese.local',
      'Técnico Demo',
      passwordHash,
    );
    const technicianId = await upsertTechnician(client, technicianUserId, 'CREA-SEED-001', 'Segurança do Trabalho');
    await assignTechnician(client, technicianId, tenantA);
    await assignTechnician(client, technicianId, tenantB);

    const partnerUserId = await upsertUser(
      client,
      null,
      'parceiro',
      'parceiro.demo@seed.montese.local',
      'Parceiro Demo',
      passwordHash,
    );
    const partnerId = await upsertPartner(client, partnerUserId, 'Criciúma/SC');
    await assignPartner(client, partnerId, tenantA);

    await upsertEmployee(client, tenantA, 'Funcionário Demo A1', '10000000001');
    await upsertEmployee(client, tenantA, 'Funcionário Demo A2', '10000000002');
    await upsertEmployee(client, tenantB, 'Funcionário Demo B1', '10000000003');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log('Seed concluído.\n');
  console.log(`Login de demonstração (senha para todos: ${SEED_PASSWORD}):`);
  console.log('  Empresa A: rh-a@seed.montese.local');
  console.log('  Empresa B: rh-b@seed.montese.local');
  console.log('  Técnico:   tecnico.demo@seed.montese.local');
  console.log('  Parceiro:  parceiro.demo@seed.montese.local');
}

async function upsertTenant(client: Client, name: string, cnpj: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, cnpj, plan, status) VALUES ($1, $2, 'trial', 'ativo')
     ON CONFLICT (cnpj) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, cnpj],
  );
  return result.rows[0].id;
}

async function upsertUser(
  client: Client,
  tenantId: string | null,
  role: string,
  email: string,
  fullName: string,
  passwordHash: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
     VALUES ($1, $2, $3, $4, $5, 'ativo')
     ON CONFLICT ((lower(email)))
     DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name
     RETURNING id`,
    [tenantId, role, email, passwordHash, fullName],
  );
  return result.rows[0].id;
}

async function upsertTechnician(
  client: Client,
  userId: string,
  registrationNumber: string,
  specialization: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO technicians (user_id, registration_number, specialization, status)
     VALUES ($1, $2, $3, 'ativo')
     ON CONFLICT (user_id) DO UPDATE SET registration_number = EXCLUDED.registration_number
     RETURNING id`,
    [userId, registrationNumber, specialization],
  );
  return result.rows[0].id;
}

async function upsertPartner(client: Client, userId: string, serviceRegion: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO partners (user_id, service_region, status) VALUES ($1, $2, 'ativo')
     ON CONFLICT (user_id) DO UPDATE SET service_region = EXCLUDED.service_region
     RETURNING id`,
    [userId, serviceRegion],
  );
  return result.rows[0].id;
}

async function assignTechnician(client: Client, technicianId: string, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)
     ON CONFLICT (tenant_id, technician_id) DO UPDATE SET status = 'ativo'`,
    [tenantId, technicianId],
  );
}

async function assignPartner(client: Client, partnerId: string, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)
     ON CONFLICT (tenant_id, partner_id) DO UPDATE SET status = 'ativo'`,
    [tenantId, partnerId],
  );
}

async function upsertEmployee(client: Client, tenantId: string, fullName: string, cpf: string): Promise<void> {
  await client.query(
    `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo')
     ON CONFLICT (tenant_id, cpf) DO UPDATE SET full_name = EXCLUDED.full_name`,
    [tenantId, fullName, cpf],
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
