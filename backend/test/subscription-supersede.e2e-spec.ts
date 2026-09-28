import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb } from './db-test-helper';

// ITEM 011 (auditoria 2026-09-27): trocar de plano criava uma assinatura nova e
// nunca cancelava a anterior — dois preapprovals cobrando ao mesmo tempo. Agora,
// quando o webhook confirma que uma assinatura virou 'authorized', as OUTRAS
// 'authorized' do mesmo sujeito (empresa ou técnico) são canceladas.
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;
const WEBHOOK_SECRET = 'teste-segredo-webhook-supersede';

function signed(dataId: string): { ts: string; signature: string; requestId: string } {
  const ts = String(Date.now());
  const requestId = `req-${randomUUID()}`;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return { ts, requestId, signature: `ts=${ts},v1=${createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex')}` };
}

describe('Troca de plano cancela a assinatura anterior (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let raw: Client;
  let startPlanId: string;
  let premiumPlanId: string;
  let tecnicoPlanId: string;
  const fakeMp = {
    getPreapproval: jest.fn(),
    updatePreapprovalStatus: jest.fn(),
    createPreapproval: jest.fn(),
    getAuthorizedPayment: jest.fn(),
  };

  beforeAll(async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMp)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    raw = new Client({ connectionString: SUPERUSER_URL });
    await raw.connect();
    const plans = await raw.query(`SELECT id, slug FROM plans WHERE slug IN ('empresa-start','empresa-premium','tecnico-start')`);
    const idOf = (slug: string) => plans.rows.find((p) => p.slug === slug).id;
    startPlanId = idOf('empresa-start');
    premiumPlanId = idOf('empresa-premium');
    tecnicoPlanId = idOf('tecnico-start');
  });

  beforeEach(() => {
    fakeMp.getPreapproval.mockReset();
    fakeMp.updatePreapprovalStatus.mockReset();
    // Por padrão o Mercado Pago confirma o cancelamento pedido.
    fakeMp.updatePreapprovalStatus.mockImplementation(async (id: string, status: string) => ({ id, status }));
  });

  afterAll(async () => {
    await raw.end();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const addSub = async (subject: { tenantId?: string; technicianUserId?: string }, planId: string, status: string) => {
    const preapprovalId = `pre-${randomUUID()}`;
    await raw.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [planId, subject.tenantId ?? null, subject.technicianUserId ?? null, status, preapprovalId],
    );
    return preapprovalId;
  };
  const statusOf = async (preapprovalId: string): Promise<string> =>
    (await raw.query('SELECT status FROM subscriptions WHERE mercadopago_preapproval_id = $1', [preapprovalId])).rows[0].status;

  // Simula o Mercado Pago avisando que `preapprovalId` está no estado `mpStatus`.
  const webhook = (preapprovalId: string, mpStatus: string) => {
    fakeMp.getPreapproval.mockResolvedValue({ id: preapprovalId, status: mpStatus });
    const sig = signed(preapprovalId);
    return request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': preapprovalId, type: 'subscription_preapproval' })
      .set('x-signature', sig.signature)
      .set('x-request-id', sig.requestId)
      .send({});
  };

  it('upgrade: a nova vira authorized, a anterior é cancelada (no Mercado Pago e no banco), tenants.plan acompanha', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Plano');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');

    const res = await webhook(newId, 'authorized');

    expect(res.status).toBe(201);
    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledTimes(1);
    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledWith(oldId, 'cancelled');
    expect(await statusOf(oldId)).toBe('cancelled');
    expect(await statusOf(newId)).toBe('authorized');
    const authorized = await raw.query(`SELECT count(*) FROM subscriptions WHERE tenant_id = $1 AND status = 'authorized'`, [
      tenant.tenantId,
    ]);
    expect(Number(authorized.rows[0].count)).toBe(1);
    const plan = await raw.query('SELECT plan FROM tenants WHERE id = $1', [tenant.tenantId]);
    expect(plan.rows[0].plan).toBe('Premium');
  });

  it('idempotente: reentrega do MESMO webhook não cancela nada de novo', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Reentrega');
    await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');

    await webhook(newId, 'authorized');
    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledTimes(1);
    fakeMp.updatePreapprovalStatus.mockClear();

    const again = await webhook(newId, 'authorized');
    expect(again.status).toBe(201);
    expect(fakeMp.updatePreapprovalStatus).not.toHaveBeenCalled();
    expect(await statusOf(newId)).toBe('authorized');
  });

  it('a mais NOVA vence: aviso atrasado da assinatura ANTIGA (ainda authorized) não cancela a nova', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Webhook Atrasado');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'authorized');

    // Sem a regra, este webhook cancelaria `newId` e o cliente ficaria sem plano
    // (o webhook de `newId` cancelaria `oldId` ao mesmo tempo).
    const res = await webhook(oldId, 'authorized');

    expect(res.status).toBe(201);
    expect(fakeMp.updatePreapprovalStatus).not.toHaveBeenCalled();
    expect(await statusOf(newId)).toBe('authorized');
    expect(await statusOf(oldId)).toBe('authorized');
  });

  it('só mexe no MESMO sujeito: assinatura authorized de outra empresa fica intacta', async () => {
    const a = await db.createTenantWithUser('Empresa Troca A');
    const b = await db.createTenantWithUser('Empresa Troca B');
    const oldA = await addSub({ tenantId: a.tenantId }, startPlanId, 'authorized');
    const subB = await addSub({ tenantId: b.tenantId }, startPlanId, 'authorized');
    const newA = await addSub({ tenantId: a.tenantId }, premiumPlanId, 'pending');

    await webhook(newA, 'authorized');

    expect(await statusOf(oldA)).toBe('cancelled');
    expect(await statusOf(subB)).toBe('authorized');
    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledTimes(1);
    expect(fakeMp.updatePreapprovalStatus).not.toHaveBeenCalledWith(subB, expect.anything());
  });

  it('técnico: mesma regra para assinatura de técnico', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Troca Plano');
    const oldId = await addSub({ technicianUserId: tecnico.userId }, tecnicoPlanId, 'authorized');
    const newId = await addSub({ technicianUserId: tecnico.userId }, tecnicoPlanId, 'pending');

    await webhook(newId, 'authorized');

    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledWith(oldId, 'cancelled');
    expect(await statusOf(oldId)).toBe('cancelled');
    expect(await statusOf(newId)).toBe('authorized');
  });

  it('nova assinatura que NÃO virou authorized (pending/paused) não cancela a anterior', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Nao Autorizou');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');

    await webhook(newId, 'pending');
    await webhook(newId, 'paused');

    expect(fakeMp.updatePreapprovalStatus).not.toHaveBeenCalled();
    expect(await statusOf(oldId)).toBe('authorized');
  });

  it('o status gravado é o CONFIRMADO pelo Mercado Pago, não o pedido', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Confirmado');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.updatePreapprovalStatus.mockImplementation(async (id: string) => ({ id, status: 'paused' }));

    await webhook(newId, 'authorized');

    expect(await statusOf(oldId)).toBe('paused');
  });

  it('erro PERMANENTE (4xx) ao cancelar a anterior: o webhook responde ok e a nova continua authorized', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca 4xx');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.updatePreapprovalStatus.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

    const res = await webhook(newId, 'authorized');

    expect(res.status).toBe(201);
    expect(await statusOf(newId)).toBe('authorized');
    expect(await statusOf(oldId)).toBe('authorized'); // fica para a reconciliação (ITEM 030)
  });

  it('erro TRANSIENTE (5xx): o webhook falha para o Mercado Pago reenviar, e a reentrega conclui o cancelamento', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca 5xx');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.updatePreapprovalStatus.mockRejectedValueOnce(Object.assign(new Error('mp fora do ar'), { status: 503 }));

    const first = await webhook(newId, 'authorized');
    expect(first.status).toBe(500);
    expect(await statusOf(newId)).toBe('authorized'); // a nova já está gravada
    expect(await statusOf(oldId)).toBe('authorized'); // a anterior ainda não saiu

    const retry = await webhook(newId, 'authorized');
    expect(retry.status).toBe(201);
    expect(await statusOf(oldId)).toBe('cancelled');
  });

  it('a função SQL não vaza: só devolve ids do mesmo sujeito e só de assinaturas authorized', async () => {
    const tenant = await db.createTenantWithUser('Empresa Troca Funcao');
    const cancelled = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'cancelled');
    const authorizedOld = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'authorized');
    const rows = (await raw.query('SELECT preapproval_id FROM payments_superseded_preapprovals($1)', [newId])).rows.map(
      (r) => r.preapproval_id,
    );
    expect(rows).toEqual([authorizedOld]);
    expect(rows).not.toContain(cancelled);
    expect(rows).not.toContain(newId);
    // Direção inversa: perguntando pela MAIS ANTIGA, nada volta — ela nunca cancela a mais nova.
    const reverse = (await raw.query('SELECT preapproval_id FROM payments_superseded_preapprovals($1)', [authorizedOld])).rows;
    expect(reverse).toEqual([]);
  });
});
