import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';
import { TestDb } from './db-test-helper';

// ITEM 023 (auditoria 2026-09-27): quem perdia o link de confirmação de 48h ficava sem saída
// (recadastrar dá 409). POST /auth/resend-confirmation gera um link novo para conta PENDENTE.
describe('Reenvio do e-mail de confirmação (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  const sent: { to: string; subject: string; html: string }[] = [];
  const fakeEmail = { send: jest.fn(async (input: { to: string; subject: string; html: string }) => void sent.push(input)) };

  const clearKeys = async () => {
    for (const pattern of ['resend-confirmation:*', 'ratelimit:AuthController.resendConfirmation:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
  };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.teste.montese.local';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    redis = new Redis(process.env.REDIS_URL as string);
    db = new TestDb();
    await db.connect();
  });

  beforeEach(async () => {
    sent.length = 0;
    await clearKeys();
  });

  afterAll(async () => {
    await clearKeys();
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const resend = (email: string) => api().post('/auth/resend-confirmation').send({ email });
  const login = (email: string, password: string) => api().post('/auth/login').send({ email, password });
  const setStatus = (userId: string, status: string) =>
    (db as any).client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
  const statusOf = async (userId: string): Promise<string> =>
    (await (db as any).client.query('SELECT status FROM users WHERE id = $1', [userId])).rows[0].status;
  // O envio não é aguardado pela rota (de propósito); dá um instante para o fake registrar.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

  const pendingUser = async (name: string) => {
    const user = await db.createTenantWithUser(name);
    await setStatus(user.userId, 'pendente');
    return user;
  };

  it('conta pendente: 201, UM e-mail com link novo e saudação genérica (sem nome, sem senha)', async () => {
    const user = await pendingUser('Reenvio Pendente');
    const res = await resend(user.email);
    await settle();

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('Se houver um cadastro pendente');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].subject).toContain('Confirme seu cadastro');
    expect(sent[0].html).toContain('/api/auth/confirm?token=');
    expect(sent[0].html).toContain('<p>Olá!</p>');
    expect(sent[0].html).not.toContain(user.password);
  });

  it('o link novo REALMENTE ativa a conta: antes login recusado, depois entra', async () => {
    const user = await pendingUser('Reenvio Ativa');
    expect((await login(user.email, user.password)).status).toBe(401);
    expect(await statusOf(user.userId)).toBe('pendente');

    await resend(user.email);
    await settle();
    const link = (sent[0].html.match(/href="([^"]+)"/) as RegExpMatchArray)[1];
    const token = new URL(link).searchParams.get('token') as string;

    const confirm = await api().get('/auth/confirm').query({ token });
    expect(confirm.status).toBe(302);
    expect(confirm.headers.location).toContain('status=ok');
    expect(await statusOf(user.userId)).toBe('ativo');
    expect((await login(user.email, user.password)).status).toBe(201);
  });

  it('e-mail inexistente: MESMA resposta (status e corpo) e nenhum e-mail — sem enumeração de contas', async () => {
    const real = await pendingUser('Reenvio Enumeracao');
    const realRes = await resend(real.email);
    await settle();
    sent.length = 0;
    const ghost = await resend('ninguem-existe-aqui@teste.montese.local');
    await settle();

    expect(ghost.status).toBe(realRes.status);
    expect(ghost.body).toEqual(realRes.body);
    expect(sent).toHaveLength(0);
  });

  it('conta já ATIVA: mesma resposta e nenhum e-mail (não há o que confirmar)', async () => {
    const user = await db.createTenantWithUser('Reenvio Ja Ativa');
    const res = await resend(user.email);
    await settle();
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(0);
  });

  it('conta INATIVA (desativada por admin): nenhum e-mail e o status NÃO muda — o link reabriria o acesso', async () => {
    const user = await db.createTenantWithUser('Reenvio Inativa');
    await setStatus(user.userId, 'inativo');
    const res = await resend(user.email);
    await settle();
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(0);
    expect(await statusOf(user.userId)).toBe('inativo');
    expect((await login(user.email, user.password)).status).toBe(401);
  });

  it('intervalo entre reenvios para o MESMO e-mail: o 2º pedido seguido não manda outro e-mail (mesma resposta)', async () => {
    const user = await pendingUser('Reenvio Intervalo');
    const first = await resend(user.email);
    await settle();
    const second = await resend(user.email);
    await settle();

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(sent).toHaveLength(1);
  });

  it('o intervalo guarda só o HASH do e-mail no Redis (nenhum dado pessoal na chave)', async () => {
    const user = await pendingUser('Reenvio Chave');
    await resend(user.email);
    const keys = await redis.keys('resend-confirmation:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(user.email);
    expect(keys[0]).not.toContain('@');
  });

  it('e-mail digitado em maiúsculas casa a conta', async () => {
    const user = await pendingUser('Reenvio Caixa');
    await resend(`  ${user.email.toUpperCase()}  `.trim());
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('corpo inválido é 400 (não 500): malformado, ausente, tipo errado e campo extra', async () => {
    const post = (body: unknown) => api().post('/auth/resend-confirmation').send(body as object);
    expect((await post({ email: 'nao-e-email' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ email: { $ne: null } })).status).toBe(400);
    expect((await post({ email: 'a@b.com', admin: true })).status).toBe(400);
  });

  it('limita por IP+e-mail: o 4º pedido seguido para o mesmo e-mail vira 429', async () => {
    const user = await pendingUser('Reenvio RateLimit');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await resend(user.email)).status);
    expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  it('auditoria: registra o reenvio, sem token nem senha', async () => {
    const user = await pendingUser('Reenvio Auditoria');
    await resend(user.email);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 300)); // audit.log é fire-and-forget
    const rows = (
      await (db as any).client.query(
        `SELECT action, path, detail FROM audit_log WHERE actor_user_id = $1 AND action = 'resend_confirmation'`,
        [user.userId],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/auth/resend-confirmation');
    expect(JSON.stringify(rows)).not.toContain('token=');
    expect(JSON.stringify(rows)).not.toContain(user.password);
  });
});
