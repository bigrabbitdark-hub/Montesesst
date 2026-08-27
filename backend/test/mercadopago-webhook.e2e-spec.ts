import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;
const WEBHOOK_SECRET = 'teste-segredo-webhook';

function buildSignature(dataId: string, requestId: string, ts: string, secret: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hash = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${hash}`;
}

describe('POST /payments/mercadopago/webhook (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let tenantId: string;
  let planId: string;
  const fakeMercadoPago = {
    getPreapproval: jest.fn(),
    createPreapproval: jest.fn(),
    getAuthorizedPayment: jest.fn(),
  };

  beforeAll(async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();

    const tenantResult = await db.query(
      `INSERT INTO tenants (name, cnpj, status, plan) VALUES ('Empresa Webhook Teste', '63025866000135', 'ativo', 'trial') RETURNING id`,
    );
    tenantId = tenantResult.rows[0].id;

    const planResult = await db.query(`SELECT id FROM plans WHERE slug = 'empresa-premium'`);
    planId = planResult.rows[0].id;

    await db.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'pending', 'preapproval-webhook-teste')`,
      [planId, tenantId],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.end();
    await app.close();
  });

  it('rejeita com 401 quando a assinatura HMAC não bate', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'preapproval-webhook-teste', type: 'subscription_preapproval' })
      .set('x-signature', 'ts=123,v1=assinatura-forjada')
      .set('x-request-id', 'req-teste')
      .send({});

    expect(res.status).toBe(401);
    expect(fakeMercadoPago.getPreapproval).not.toHaveBeenCalled();
  });

  it('ativa a assinatura e atualiza tenants.plan quando a assinatura HMAC é válida', async () => {
    fakeMercadoPago.getPreapproval.mockResolvedValueOnce({
      id: 'preapproval-webhook-teste',
      status: 'authorized',
    });

    const ts = String(Date.now());
    const requestId = 'req-valido';
    const signature = buildSignature('preapproval-webhook-teste', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'preapproval-webhook-teste', type: 'subscription_preapproval' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(fakeMercadoPago.getPreapproval).toHaveBeenCalledWith('preapproval-webhook-teste');

    const row = await db.query('SELECT status FROM subscriptions WHERE mercadopago_preapproval_id = $1', [
      'preapproval-webhook-teste',
    ]);
    expect(row.rows[0].status).toBe('authorized');

    const tenantRow = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
    expect(tenantRow.rows[0].plan).toBe('Premium');
  });

  it('ignora eventos de tipo diferente de subscription_preapproval sem chamar o Mercado Pago', async () => {
    // Reseta o histórico do mock — o teste anterior já chamou getPreapproval
    // uma vez; sem isso, a asserção "not.toHaveBeenCalled" abaixo veria
    // aquela chamada antiga e falharia mesmo com o controller se comportando
    // corretamente neste teste.
    fakeMercadoPago.getPreapproval.mockClear();

    const ts = String(Date.now());
    const requestId = 'req-outro-tipo';
    const signature = buildSignature('id-qualquer', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'id-qualquer', type: 'payment' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(fakeMercadoPago.getPreapproval).not.toHaveBeenCalled();
  });

  it('loga um warning (mas ainda responde 200/ok) quando o preapproval_id não corresponde a nenhuma assinatura', async () => {
    // Finding 3 da revisão final: payments_update_subscription_status
    // devolve zero linhas pra um preapproval_id desconhecido/desatualizado
    // — antes disso era descartado silenciosamente, sem log nenhum.
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    fakeMercadoPago.getPreapproval.mockResolvedValueOnce({
      id: 'preapproval-sem-assinatura-correspondente',
      status: 'authorized',
    });

    const ts = String(Date.now());
    const requestId = 'req-sem-match';
    const signature = buildSignature(
      'preapproval-sem-assinatura-correspondente',
      requestId,
      ts,
      WEBHOOK_SECRET,
    );

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'preapproval-sem-assinatura-correspondente', type: 'subscription_preapproval' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'ok' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('preapproval-sem-assinatura-correspondente'),
    );

    warnSpy.mockRestore();
  });

  it('grava payment_events vinculado à assinatura quando preapproval_id bate', async () => {
    fakeMercadoPago.getAuthorizedPayment.mockResolvedValueOnce({
      id: 'invoice-vinculado-teste',
      preapprovalId: 'preapproval-webhook-teste',
      amountCents: 79700,
      status: 'approved',
      occurredAt: new Date().toISOString(),
    });

    const ts = String(Date.now());
    const requestId = 'req-authorized-payment-vinculado';
    const signature = buildSignature('invoice-vinculado-teste', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'invoice-vinculado-teste', type: 'subscription_authorized_payment' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(fakeMercadoPago.getAuthorizedPayment).toHaveBeenCalledWith('invoice-vinculado-teste');

    const row = await db.query(
      `SELECT pe.amount_cents, pe.status, s.mercadopago_preapproval_id
       FROM payment_events pe
       JOIN subscriptions s ON s.id = pe.subscription_id
       WHERE pe.mercadopago_payment_id = $1`,
      ['invoice-vinculado-teste'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].amount_cents).toBe(79700);
    expect(row.rows[0].status).toBe('approved');
    expect(row.rows[0].mercadopago_preapproval_id).toBe('preapproval-webhook-teste');

    await db.query('DELETE FROM payment_events WHERE mercadopago_payment_id = $1', [
      'invoice-vinculado-teste',
    ]);
  });

  it('loga warning e grava sem vínculo quando preapproval_id não corresponde a assinatura nenhuma', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    fakeMercadoPago.getAuthorizedPayment.mockResolvedValueOnce({
      id: 'invoice-sem-vinculo-teste',
      preapprovalId: 'preapproval-inexistente-teste',
      amountCents: 39700,
      status: 'approved',
      occurredAt: new Date().toISOString(),
    });

    const ts = String(Date.now());
    const requestId = 'req-authorized-payment-sem-vinculo';
    const signature = buildSignature('invoice-sem-vinculo-teste', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'invoice-sem-vinculo-teste', type: 'subscription_authorized_payment' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invoice-sem-vinculo-teste'));

    const row = await db.query(
      'SELECT subscription_id FROM payment_events WHERE mercadopago_payment_id = $1',
      ['invoice-sem-vinculo-teste'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].subscription_id).toBeNull();

    warnSpy.mockRestore();
    await db.query('DELETE FROM payment_events WHERE mercadopago_payment_id = $1', [
      'invoice-sem-vinculo-teste',
    ]);
  });

  it('reenvio do mesmo invoice com status diferente atualiza em vez de duplicar', async () => {
    fakeMercadoPago.getAuthorizedPayment.mockResolvedValueOnce({
      id: 'invoice-reenvio-teste',
      preapprovalId: 'preapproval-webhook-teste',
      amountCents: 79700,
      status: 'pending',
      occurredAt: new Date().toISOString(),
    });

    const firstTs = String(Date.now());
    const firstRequestId = 'req-authorized-payment-reenvio-1';
    const firstSignature = buildSignature('invoice-reenvio-teste', firstRequestId, firstTs, WEBHOOK_SECRET);
    await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'invoice-reenvio-teste', type: 'subscription_authorized_payment' })
      .set('x-signature', firstSignature)
      .set('x-request-id', firstRequestId)
      .send({});

    fakeMercadoPago.getAuthorizedPayment.mockResolvedValueOnce({
      id: 'invoice-reenvio-teste',
      preapprovalId: 'preapproval-webhook-teste',
      amountCents: 79700,
      status: 'approved',
      occurredAt: new Date().toISOString(),
    });

    const secondTs = String(Date.now());
    const secondRequestId = 'req-authorized-payment-reenvio-2';
    const secondSignature = buildSignature('invoice-reenvio-teste', secondRequestId, secondTs, WEBHOOK_SECRET);
    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'invoice-reenvio-teste', type: 'subscription_authorized_payment' })
      .set('x-signature', secondSignature)
      .set('x-request-id', secondRequestId)
      .send({});

    expect(res.status).toBe(201);

    const rows = await db.query(
      'SELECT status FROM payment_events WHERE mercadopago_payment_id = $1',
      ['invoice-reenvio-teste'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('approved');

    await db.query('DELETE FROM payment_events WHERE mercadopago_payment_id = $1', [
      'invoice-reenvio-teste',
    ]);
  });
});
