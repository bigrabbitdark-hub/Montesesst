import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb, TestTenantFixture } from './db-test-helper';

// Prova via RLS real (não inspeção de código) que uma empresa não vê
// assinatura de outra — spec de Planos + Assinaturas, seção 6, exige
// explicitamente "RLS confirmada (uma empresa não vê assinatura de
// outra)" pra `subscriptions`. Não existe endpoint HTTP GET /subscriptions
// nesta fase, então este teste vai direto no Postgres com a mesma role da
// aplicação (montese_app, sujeita a RLS), reproduzindo exatamente o padrão
// de `DatabaseService.withTenantContext` (BEGIN + 3x set_config +
// query) — nunca a role de superuser, que bypassa RLS e não provaria nada.
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;
const APP_URL = process.env.DATABASE_URL as string;

describe('Isolamento multi-tenant via RLS em subscriptions (e2e)', () => {
  let db: TestDb;
  let superuser: Client;
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let subscriptionAId: string;
  let subscriptionBId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    tenantA = await db.createTenantWithUser('Empresa RLS A');
    tenantB = await db.createTenantWithUser('Empresa RLS B');

    superuser = new Client({ connectionString: SUPERUSER_URL });
    await superuser.connect();

    const planResult = await superuser.query<{ id: string }>(
      `SELECT id FROM plans WHERE slug = 'empresa-start'`,
    );
    const planId = planResult.rows[0].id;

    const subA = await superuser.query<{ id: string }>(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'pending', $3) RETURNING id`,
      [planId, tenantA.tenantId, `test-preapproval-${randomUUID()}`],
    );
    subscriptionAId = subA.rows[0].id;

    const subB = await superuser.query<{ id: string }>(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'pending', $3) RETURNING id`,
      [planId, tenantB.tenantId, `test-preapproval-${randomUUID()}`],
    );
    subscriptionBId = subB.rows[0].id;
  });

  afterAll(async () => {
    // Apagados explicitamente antes do cleanup de tenants (que já cascatearia
    // via ON DELETE CASCADE) só por clareza — não é estritamente necessário.
    await superuser.query('DELETE FROM subscriptions WHERE id = ANY($1)', [
      [subscriptionAId, subscriptionBId],
    ]);
    await superuser.end();
    await db.cleanup();
    await db.disconnect();
  });

  it('empresa A só vê a própria assinatura via RLS, nunca a de empresa B', async () => {
    // Conexão separada com a role da aplicação (montese_app) — é ela quem
    // de fato tem RLS aplicada (FORCE ROW LEVEL SECURITY), diferente da
    // conexão de superuser usada acima só pra montar a fixture.
    const appClient = new Client({ connectionString: APP_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', tenantA.userId]);
      await appClient.query('SELECT set_config($1, $2, true)', [
        'app.tenant_id',
        tenantA.tenantId,
      ]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', 'empresa']);

      const result = await appClient.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM subscriptions',
      );
      const ids = result.rows.map((r) => r.id);

      expect(ids).toContain(subscriptionAId);
      expect(ids).not.toContain(subscriptionBId);

      await appClient.query('ROLLBACK');
    } finally {
      await appClient.end();
    }
  });
});
