import { TestDb } from './db-test-helper';

describe('payment_events RLS (via SQL direto)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let planId: string;
  let subscriptionAId: string;
  let subscriptionBId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Payment Events A');
    const tenantB = await db.createTenantWithUser('Empresa Payment Events B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const planResult = await (db as any).client.query(
      `SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;

    const subAResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenantAId, `preapproval-test-a-${Date.now()}`],
    );
    subscriptionAId = subAResult.rows[0].id;

    const subBResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenantBId, `preapproval-test-b-${Date.now()}`],
    );
    subscriptionBId = subBResult.rows[0].id;

    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 10000, 'approved', now())`,
      [subscriptionAId, `payment-test-a-${Date.now()}`],
    );
    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 20000, 'approved', now())`,
      [subscriptionBId, `payment-test-b-${Date.now()}`],
    );
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM payment_events WHERE subscription_id = ANY($1)', [
      [subscriptionAId, subscriptionBId],
    ]);
    await (db as any).client.query('DELETE FROM subscriptions WHERE id = ANY($1)', [
      [subscriptionAId, subscriptionBId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  it('empresa A só vê o próprio payment_event, não o de empresa B', async () => {
    await (db as any).client.query('BEGIN');
    await (db as any).client.query(`SET LOCAL app.role = 'empresa'`);
    await (db as any).client.query(`SET LOCAL app.tenant_id = '${tenantAId}'`);
    const result = await (db as any).client.query('SELECT subscription_id FROM payment_events');
    await (db as any).client.query('ROLLBACK');

    const ids = result.rows.map((r: any) => r.subscription_id);
    expect(ids).toContain(subscriptionAId);
    expect(ids).not.toContain(subscriptionBId);
  });

  it('admin vê os dois payment_events', async () => {
    await (db as any).client.query('BEGIN');
    await (db as any).client.query(`SET LOCAL app.role = 'admin'`);
    const result = await (db as any).client.query(
      'SELECT subscription_id FROM payment_events WHERE subscription_id = ANY($1)',
      [[subscriptionAId, subscriptionBId]],
    );
    await (db as any).client.query('ROLLBACK');

    const ids = result.rows.map((r: any) => r.subscription_id);
    expect(ids).toContain(subscriptionAId);
    expect(ids).toContain(subscriptionBId);
  });

  it('payments_record_payment_event grava e ignora reenvio duplicado (idempotência)', async () => {
    const paymentId = `payment-idempotencia-${Date.now()}`;
    const first = await (db as any).client.query(
      `SELECT * FROM payments_record_payment_event($1, $2, $3, $4, now())`,
      [paymentId, `preapproval-test-a-${subscriptionAId}`, 5000, 'approved'],
    );
    // preapproval_id inventado não bate com nenhuma assinatura real —
    // prova que o evento ainda é gravado, sem vínculo.
    expect(first.rows[0].subscription_id).toBeNull();

    const second = await (db as any).client.query(
      `SELECT * FROM payments_record_payment_event($1, $2, $3, $4, now())`,
      [paymentId, `preapproval-test-a-${subscriptionAId}`, 5000, 'approved'],
    );
    // ON CONFLICT DO NOTHING: reenvio não gera segunda linha, id vem NULL
    // (RETURNING não encontra a linha que não foi inserida de novo).
    expect(second.rows[0].id).toBeNull();

    await (db as any).client.query('DELETE FROM payment_events WHERE mercadopago_payment_id = $1', [
      paymentId,
    ]);
  });
});
