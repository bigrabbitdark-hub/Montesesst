import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { SubscriptionReconciliationCronService } from '../src/payments/subscription-reconciliation.cron';
import { TestDb } from './db-test-helper';

// ITEM 030 (auditoria 2026-09-27): sem isto, um webhook perdido deixava uma assinatura
// desatualizada indefinidamente — o cron pergunta ao Mercado Pago o status real das
// pending/authorized e aplica a MESMA função SQL que o webhook usa.
const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

describe('Reconciliação periódica banco↔Mercado Pago (e2e)', () => {
  let db: TestDb;
  let raw: Client;
  let cron: SubscriptionReconciliationCronService;
  let startPlanId: string;
  let premiumPlanId: string;
  const fakeMp = { getPreapproval: jest.fn(), updatePreapprovalStatus: jest.fn() };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMp)
      .compile();
    // Só resolve o provider — não sobe HTTP nenhum (o cron não expõe rota).
    cron = moduleRef.get(SubscriptionReconciliationCronService);

    db = new TestDb();
    await db.connect();
    raw = new Client({ connectionString: SUPERUSER_URL });
    await raw.connect();
    const plans = await raw.query(`SELECT id, slug FROM plans WHERE slug IN ('empresa-start','empresa-premium')`);
    const idOf = (slug: string) => plans.rows.find((p) => p.slug === slug).id;
    startPlanId = idOf('empresa-start');
    premiumPlanId = idOf('empresa-premium');
  });

  beforeEach(() => {
    fakeMp.getPreapproval.mockReset();
    fakeMp.updatePreapprovalStatus.mockReset();
    fakeMp.updatePreapprovalStatus.mockImplementation(async (id: string, status: string) => ({ id, status }));
  });

  afterAll(async () => {
    await raw.end();
    await db.cleanup();
    await db.disconnect();
  });

  const addSub = async (subject: { tenantId?: string; technicianUserId?: string }, planId: string, status: string) => {
    const preapprovalId = `pre-reconcile-${randomUUID()}`;
    await raw.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [planId, subject.tenantId ?? null, subject.technicianUserId ?? null, status, preapprovalId],
    );
    return preapprovalId;
  };
  const statusOf = async (preapprovalId: string): Promise<string> =>
    (await raw.query('SELECT status FROM subscriptions WHERE mercadopago_preapproval_id = $1', [preapprovalId])).rows[0].status;
  const planOf = async (tenantId: string): Promise<string> =>
    (await raw.query('SELECT plan FROM tenants WHERE id = $1', [tenantId])).rows[0].plan;

  it('pending no banco, o Mercado Pago já confirma authorized: corrige o status e sincroniza tenants.plan', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Authorized');
    const preapprovalId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.getPreapproval.mockResolvedValue({ id: preapprovalId, status: 'authorized' });

    const result = await cron.runOnce();

    expect(result.changed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(preapprovalId)).toBe('authorized');
    expect(await planOf(tenant.tenantId)).toBe('Premium');
  });

  it('authorized no banco, o Mercado Pago diz cancelled (webhook perdido): corrige pra cancelled', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Cancelled');
    const preapprovalId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    fakeMp.getPreapproval.mockImplementation(async (id: string) =>
      id === preapprovalId ? { id, status: 'cancelled' } : { id, status: 'pending' },
    );

    await cron.runOnce();

    expect(await statusOf(preapprovalId)).toBe('cancelled');
  });

  it('status já bate: não chama update nenhum, não conta como alterada', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Sem Mudanca');
    const preapprovalId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    fakeMp.getPreapproval.mockImplementation(async (id: string) => ({ id, status: 'authorized' }));

    await cron.runOnce();

    expect(fakeMp.updatePreapprovalStatus).not.toHaveBeenCalled();
    expect(await statusOf(preapprovalId)).toBe('authorized');
  });

  it('reconciliar pending->authorized cancela a assinatura authorized anterior do MESMO sujeito (ITEM 011)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Supersede');
    const oldId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'authorized');
    const newId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.getPreapproval.mockImplementation(async (id: string) =>
      id === newId ? { id, status: 'authorized' } : { id, status: oldId === id ? 'authorized' : 'pending' },
    );

    await cron.runOnce();

    expect(fakeMp.updatePreapprovalStatus).toHaveBeenCalledWith(oldId, 'cancelled');
    expect(await statusOf(oldId)).toBe('cancelled');
    expect(await statusOf(newId)).toBe('authorized');
  });

  it('cancelled e paused no banco NUNCA são consultadas no Mercado Pago — fora do escopo do cron', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Fora Escopo');
    const cancelledId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'cancelled');
    const pausedId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'paused');
    fakeMp.getPreapproval.mockResolvedValue({ id: 'nao deveria ser chamado', status: 'authorized' });

    await cron.runOnce();

    expect(fakeMp.getPreapproval).not.toHaveBeenCalledWith(cancelledId);
    expect(fakeMp.getPreapproval).not.toHaveBeenCalledWith(pausedId);
    expect(await statusOf(cancelledId)).toBe('cancelled');
    expect(await statusOf(pausedId)).toBe('paused');
  });

  it('uma falha do Mercado Pago numa assinatura não impede a reconciliação das demais', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Falha Parcial');
    const brokenId = await addSub({ tenantId: tenant.tenantId }, startPlanId, 'pending');
    const okId = await addSub({ tenantId: tenant.tenantId }, premiumPlanId, 'pending');
    fakeMp.getPreapproval.mockImplementation(async (id: string) => {
      if (id === brokenId) throw Object.assign(new Error('Mercado Pago fora do ar'), { status: 503 });
      return { id, status: 'authorized' };
    });

    const result = await cron.runOnce();

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(brokenId)).toBe('pending'); // não mudou — falhou antes de gravar
    expect(await statusOf(okId)).toBe('authorized'); // a outra seguiu normalmente
  });

  it('técnico: mesma reconciliação funciona pro ramo technician_user_id (sem tenant_id)', async () => {
    const tecnicoPlan = (await raw.query(`SELECT id FROM plans WHERE slug = 'tecnico-start'`)).rows[0].id;
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Reconcilia');
    const preapprovalId = await addSub({ technicianUserId: tecnico.userId }, tecnicoPlan, 'pending');
    fakeMp.getPreapproval.mockResolvedValue({ id: preapprovalId, status: 'authorized' });

    await cron.runOnce();

    expect(await statusOf(preapprovalId)).toBe('authorized');
  });

  it('assinatura sem mercadopago_preapproval_id (NULL) é ignorada — nunca chama o Mercado Pago com id nenhum', async () => {
    const tenant = await db.createTenantWithUser('Empresa Reconcilia Sem Preapproval');
    await raw.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id) VALUES ($1, $2, 'pending', NULL)`,
      [startPlanId, tenant.tenantId],
    );

    await expect(cron.runOnce()).resolves.toBeDefined();
    expect(fakeMp.getPreapproval).not.toHaveBeenCalledWith(undefined);
    expect(fakeMp.getPreapproval).not.toHaveBeenCalledWith(null);
  });
});
