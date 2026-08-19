import { INestApplication } from '@nestjs/common';
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
  const fakeMercadoPago = { getPreapproval: jest.fn(), createPreapproval: jest.fn() };

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
});
