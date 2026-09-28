import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb } from './db-test-helper';

// Nunca chama o Mercado Pago de verdade: o teste de POST /subscriptions só
// precisa provar que a guard NÃO barra a rota, não que o checkout funciona.
const fakeMercadoPago = {
  createPreapproval: jest.fn().mockResolvedValue({
    id: 'fake-preapproval-guard-test',
    initPoint: 'https://example.test/checkout',
    status: 'pending',
  }),
};

// ITEM 002 (auditoria 2026-09-27): cancelamento/inadimplência de assinatura
// não tinha nenhum efeito de bloqueio de acesso. Este teste prova, contra a
// aplicação HTTP real (não inspeção de código), a política decidida com o
// fundador: bloqueio imediato quando existiu assinatura e ela não está mais
// ativa, mas SEM bloquear quem nunca assinou (trial) nem quem está com
// checkout em andamento ('pending').
async function insertSubscription(db: any, tenantId: string, status: string, planSlug = 'empresa-start', ageDays = 0) {
  const planRes = await db.client.query('SELECT id FROM plans WHERE slug = $1', [planSlug]);
  await db.client.query(
    `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id, created_at)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5::int))`,
    [planRes.rows[0].id, tenantId, status, `test-preapproval-${tenantId}-${status}-${Math.random()}`, ageDays],
  );
}

async function loginToken(app: INestApplication, email: string, password: string): Promise<string> {
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  return login.body.access_token;
}

describe('SubscriptionStatusGuard — bloqueio por assinatura inativa (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    // Mesmo padrão de google-calendar.e2e-spec.ts: GoogleOAuthCalendarClientService
    // falha no boot sem estas vars (F-27), mesmo quando o teste não usa Google.
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia rota protegida quando a única assinatura existente está cancelled', async () => {
    const tenant = await db.createTenantWithUser('Empresa Cancelada');
    await insertSubscription(db, tenant.tenantId, 'cancelled');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('bloqueia rota protegida quando a única assinatura existente está paused', async () => {
    const tenant = await db.createTenantWithUser('Empresa Pausada');
    await insertSubscription(db, tenant.tenantId, 'paused');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('NÃO bloqueia tenant em trial (nunca assinou, nenhuma linha em subscriptions)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Trial');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('NÃO bloqueia tenant com assinatura authorized', async () => {
    const tenant = await db.createTenantWithUser('Empresa Ativa');
    await insertSubscription(db, tenant.tenantId, 'authorized');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('NÃO bloqueia tenant com checkout em andamento (pending), mesmo tendo uma cancelled anterior', async () => {
    const tenant = await db.createTenantWithUser('Empresa Pending');
    await insertSubscription(db, tenant.tenantId, 'cancelled');
    await insertSubscription(db, tenant.tenantId, 'pending');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('pending ABANDONADO (mais de 3 dias) não protege: cancelled + pending velho continua bloqueado', async () => {
    const tenant = await db.createTenantWithUser('Empresa Pending Velho');
    await insertSubscription(db, tenant.tenantId, 'cancelled');
    await insertSubscription(db, tenant.tenantId, 'pending', 'empresa-premium', 10);
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('pending abandonado SEM assinatura anterior (nunca pagou) segue como trial: não bloqueia', async () => {
    const tenant = await db.createTenantWithUser('Empresa Pending Velho Trial');
    await insertSubscription(db, tenant.tenantId, 'pending', 'empresa-premium', 10);
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('técnico com assinatura própria cancelled é bloqueado (ramo technician_user_id, sem tenantId)', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Cancelado');
    const planRes = await (db as any).client.query('SELECT id FROM plans WHERE slug = $1', ['tecnico-start']);
    await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, technician_user_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'cancelled', $3)`,
      [planRes.rows[0].id, tecnico.userId, `test-preapproval-tec-${tecnico.userId}`],
    );
    const token = await loginToken(app, tecnico.email, tecnico.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('técnico que nunca assinou (trial) NÃO é bloqueado pela guard', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Trial');
    const token = await loginToken(app, tecnico.email, tecnico.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.code).not.toBe('SUBSCRIPTION_INACTIVE');
  });

  it('admin nunca é bloqueado pela guard', async () => {
    const admin = await db.createUserWithRole('admin', 'Admin Guard');
    const token = await loginToken(app, admin.email, admin.password);

    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.code).not.toBe('SUBSCRIPTION_INACTIVE');
  });

  describe('GET /subscriptions/me — o cliente sabe em que estado está (ITEM 016)', () => {
    const getMe = (token: string) => request(app.getHttpServer()).get('/subscriptions/me').set('Authorization', `Bearer ${token}`);

    it('nunca assinou -> trial', async () => {
      const tenant = await db.createTenantWithUser('Empresa Me Trial');
      const res = await getMe(await loginToken(app, tenant.email, tenant.password));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ access: 'trial' });
    });

    it('assinatura authorized -> ativa', async () => {
      const tenant = await db.createTenantWithUser('Empresa Me Ativa');
      await insertSubscription(db, tenant.tenantId, 'authorized');
      expect((await getMe(await loginToken(app, tenant.email, tenant.password))).body).toEqual({ access: 'ativa' });
    });

    it('checkout recente em andamento -> pendente', async () => {
      const tenant = await db.createTenantWithUser('Empresa Me Pendente');
      await insertSubscription(db, tenant.tenantId, 'pending');
      expect((await getMe(await loginToken(app, tenant.email, tenant.password))).body).toEqual({ access: 'pendente' });
    });

    it('cancelada -> inativa, e o endpoint continua ACESSÍVEL mesmo com a guarda bloqueando o resto', async () => {
      const tenant = await db.createTenantWithUser('Empresa Me Inativa');
      await insertSubscription(db, tenant.tenantId, 'cancelled');
      const token = await loginToken(app, tenant.email, tenant.password);

      const me = await getMe(token);
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ access: 'inativa' });
      // ...enquanto o resto do sistema segue bloqueado:
      expect((await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    });

    it('cancelada + pending ABANDONADO (velho) -> continua inativa', async () => {
      const tenant = await db.createTenantWithUser('Empresa Me Pending Velho');
      await insertSubscription(db, tenant.tenantId, 'cancelled');
      await insertSubscription(db, tenant.tenantId, 'pending', 'empresa-premium', 10);
      expect((await getMe(await loginToken(app, tenant.email, tenant.password))).body).toEqual({ access: 'inativa' });
    });

    it('técnico cancelado -> inativa', async () => {
      const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Me Inativo');
      const planRes = await (db as any).client.query('SELECT id FROM plans WHERE slug = $1', ['tecnico-start']);
      await (db as any).client.query(
        `INSERT INTO subscriptions (plan_id, technician_user_id, status, mercadopago_preapproval_id) VALUES ($1, $2, 'cancelled', $3)`,
        [planRes.rows[0].id, tecnico.userId, `test-preapproval-me-${tecnico.userId}`],
      );
      expect((await getMe(await loginToken(app, tecnico.email, tecnico.password))).body).toEqual({ access: 'inativa' });
    });

    it('admin não usa este endpoint (403 pelo papel), e sem login é 401', async () => {
      const admin = await db.createUserWithRole('admin', 'Admin Me');
      expect((await getMe(await loginToken(app, admin.email, admin.password))).status).toBe(403);
      expect((await request(app.getHttpServer()).get('/subscriptions/me')).status).toBe(401);
    });
  });

  it('mesmo bloqueado, GET /auth/me continua respondendo (frontend precisa saber quem está logado)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Bloqueada Me');
    await insertSubscription(db, tenant.tenantId, 'cancelled');
    const token = await loginToken(app, tenant.email, tenant.password);

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('mesmo bloqueado, POST /subscriptions continua acessível (rota de reativar o plano)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Bloqueada Reativa');
    await insertSubscription(db, tenant.tenantId, 'cancelled');
    const token = await loginToken(app, tenant.email, tenant.password);

    const planRes = await (db as any).client.query('SELECT id FROM plans WHERE slug = $1', ['empresa-premium']);

    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan_id: planRes.rows[0].id });

    // Não deve ser barrado pela SubscriptionStatusGuard — se chegar a
    // service, pode falhar por outro motivo (ex.: Mercado Pago mockado
    // ausente no ambiente de teste), mas nunca com o código específico
    // desta guard.
    expect(res.body.code).not.toBe('SUBSCRIPTION_INACTIVE');
  });
});
