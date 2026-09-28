import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';
import { TestDb, TestTenantFixture } from './db-test-helper';

// ITEM 022 (auditoria 2026-09-27): recuperação de senha. Cobre o fluxo completo
// pela API real (e-mail capturado por um fake — nenhum e-mail é enviado).
const NEW_PASSWORD = 'nova-senha-segura-456';

describe('Recuperação de senha (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let jwt: JwtService;
  const sent: { to: string; subject: string; html: string }[] = [];
  const fakeEmail = { send: jest.fn(async (input: { to: string; subject: string; html: string }) => void sent.push(input)) };

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
    jwt = moduleRef.get(JwtService);
    redis = new Redis(process.env.REDIS_URL as string);
    db = new TestDb();
    await db.connect();
  });

  // O limite de reset-password é POR IP (todos os testes saem do mesmo loopback) e este
  // arquivo passa de 10 chamadas: sem limpar entre os testes, a partir da 11ª tudo vira
  // 429 por causa de OUTROS testes (mesmo motivo do REGISTER_RATE_LIMIT_KEY em register.e2e-spec).
  const clearIpLimits = async () => {
    const keys = await redis.keys('ratelimit:AuthController.resetPassword:*');
    if (keys.length) await redis.del(...keys);
  };

  beforeEach(async () => {
    sent.length = 0;
    await clearIpLimits();
  });

  afterAll(async () => {
    await clearIpLimits();
    const keys = await redis.keys('ratelimit:AuthController.*:*@teste.montese.local');
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const forgot = (email: string) => api().post('/auth/forgot-password').send({ email });
  const reset = (token: string, password = NEW_PASSWORD) => api().post('/auth/reset-password').send({ token, password });
  const login = (email: string, password: string) => api().post('/auth/login').send({ email, password });
  const dbRow = async (userId: string) =>
    (await (db as any).client.query('SELECT password_hash, status FROM users WHERE id = $1', [userId])).rows[0];

  // Extrai o token do fragmento do link enviado por e-mail.
  const tokenFromEmail = (): string => {
    expect(sent).toHaveLength(1);
    const match = sent[0].html.match(/redefinir-senha#token=([A-Za-z0-9._-]+)/);
    expect(match).not.toBeNull();
    return match![1];
  };

  // Cada teste usa seu próprio usuário (a chave de rate limit é IP+e-mail).
  const newUser = (name: string): Promise<TestTenantFixture> => db.createTenantWithUser(name);

  describe('POST /auth/forgot-password', () => {
    it('conta ativa: 200, envia UM e-mail com link em fragmento (#), válido por 1h, sem a senha nem o hash', async () => {
      const user = await newUser('Reset Envia');
      const res = await forgot(user.email);

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Se o e-mail estiver cadastrado');
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(user.email);
      expect(sent[0].html).toContain('/redefinir-senha#token=');
      expect(sent[0].html).not.toContain('?token=');
      expect(sent[0].html).not.toContain((await dbRow(user.userId)).password_hash);

      const payload: any = jwt.decode(tokenFromEmail());
      expect(payload.purpose).toBe('password_reset');
      expect(payload.exp - payload.iat).toBe(3600);
    });

    it('e-mail inexistente: MESMA resposta (status e corpo), nenhum e-mail enviado — sem enumeração de contas', async () => {
      const real = await newUser('Reset Enumeracao');
      const realRes = await forgot(real.email);
      sent.length = 0;
      const ghostRes = await forgot('ninguem-existe-aqui@teste.montese.local');

      expect(ghostRes.status).toBe(realRes.status);
      expect(ghostRes.body).toEqual(realRes.body);
      expect(sent).toHaveLength(0);
    });

    it.each(['pendente', 'inativo'])('conta com status "%s": mesma resposta e nenhum e-mail', async (status) => {
      const user = await newUser(`Reset Status ${status}`);
      await (db as any).client.query(`UPDATE users SET status = $2 WHERE id = $1`, [user.userId, status]);
      const res = await forgot(user.email);
      expect(res.status).toBe(201);
      expect(sent).toHaveLength(0);
    });

    it('e-mail digitado em maiúsculas casa a conta', async () => {
      const user = await newUser('Reset Caixa');
      await forgot(`  ${user.email.toUpperCase()}  `.trim());
      expect(sent).toHaveLength(1);
    });

    it('corpo inválido é 400 (não 500): e-mail malformado, ausente ou de tipo errado', async () => {
      expect((await api().post('/auth/forgot-password').send({ email: 'nao-e-email' })).status).toBe(400);
      expect((await api().post('/auth/forgot-password').send({})).status).toBe(400);
      expect((await api().post('/auth/forgot-password').send({ email: { $ne: null } })).status).toBe(400);
    });

    it('limita por IP+e-mail: a 6ª tentativa seguida para o mesmo e-mail vira 429', async () => {
      const user = await newUser('Reset RateLimit');
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await forgot(user.email)).status);
      expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('fluxo completo: com o token do e-mail troca a senha; a nova entra, a antiga não', async () => {
      const user = await newUser('Reset Fluxo');
      await forgot(user.email);
      const token = tokenFromEmail();
      sent.length = 0;

      const res = await reset(token);
      expect(res.status).toBe(201);

      expect((await login(user.email, NEW_PASSWORD)).status).toBe(201);
      expect((await login(user.email, user.password)).status).toBe(401);
      // Aviso de segurança para o dono da conta.
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toContain('Sua senha foi alterada');
      expect(sent[0].html).not.toContain(NEW_PASSWORD);
    });

    it('a senha nova é guardada com bcrypt (nunca em claro)', async () => {
      const user = await newUser('Reset Hash');
      await forgot(user.email);
      await reset(tokenFromEmail());
      const { password_hash } = await dbRow(user.userId);
      expect(password_hash).not.toContain(NEW_PASSWORD);
      expect(await bcrypt.compare(NEW_PASSWORD, password_hash)).toBe(true);
    });

    it('token vale UMA vez: o segundo uso do mesmo link é recusado', async () => {
      const user = await newUser('Reset Uso Unico');
      await forgot(user.email);
      const token = tokenFromEmail();
      expect((await reset(token)).status).toBe(201);
      const again = await reset(token, 'outra-senha-qualquer-789');
      expect(again.status).toBe(400);
      expect((await login(user.email, NEW_PASSWORD)).status).toBe(201);
    });

    it('duas requisições SIMULTÂNEAS com o mesmo token: só uma vence (troca atômica no banco)', async () => {
      const user = await newUser('Reset Corrida');
      await forgot(user.email);
      const token = tokenFromEmail();
      const [a, b] = await Promise.all([reset(token, 'senha-da-corrida-A-111'), reset(token, 'senha-da-corrida-B-222')]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
    });

    it('token morre se a senha mudar por outro caminho depois de emitido', async () => {
      const user = await newUser('Reset Senha Mudou');
      await forgot(user.email);
      const token = tokenFromEmail();
      await (db as any).client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        user.userId,
        await bcrypt.hash('senha-trocada-por-admin-000', 4),
      ]);
      expect((await reset(token)).status).toBe(400);
    });

    it('recusa token de OUTRA finalidade (confirmação de e-mail e sessão)', async () => {
      const user = await newUser('Reset Finalidade');
      const confirmation = jwt.sign({ sub: user.userId, purpose: 'email_confirmation' }, { expiresIn: '1h' });
      const session = (await login(user.email, user.password)).body.access_token;
      expect((await reset(confirmation)).status).toBe(400);
      expect((await reset(session)).status).toBe(400);
    });

    it('recusa token expirado, adulterado e lixo', async () => {
      const user = await newUser('Reset Invalido');
      const row = await dbRow(user.userId);
      const fp = 'x'.repeat(32);
      const expired = jwt.sign(
        { sub: user.userId, email: user.email, purpose: 'password_reset', pwf: fp },
        { expiresIn: '-10s' },
      );
      await forgot(user.email);
      const valid = tokenFromEmail();
      const tampered = valid.slice(0, -3) + (valid.endsWith('aaa') ? 'bbb' : 'aaa');
      expect(row.status).toBe('ativo');
      for (const token of [expired, tampered, 'a'.repeat(40)]) {
        expect((await reset(token)).status).toBe(400);
      }
    });

    it('recusa token válido de um usuário usado com o e-mail de outro (sub e e-mail precisam bater)', async () => {
      const a = await newUser('Reset Cruzado A');
      const b = await newUser('Reset Cruzado B');
      await forgot(a.email);
      const payloadA: any = jwt.decode(tokenFromEmail());
      const forged = jwt.sign(
        { sub: b.userId, email: a.email, purpose: 'password_reset', pwf: payloadA.pwf },
        { expiresIn: '1h' },
      );
      expect((await reset(forged)).status).toBe(400);
    });

    it('a mensagem de erro é a mesma para todo motivo (não diz se expirou, se já foi usado, etc.)', async () => {
      const user = await newUser('Reset Mensagem');
      await forgot(user.email);
      const token = tokenFromEmail();
      await reset(token);
      const used = await reset(token);
      const garbage = await reset('a'.repeat(40));
      expect(used.body.message).toBe(garbage.body.message);
    });

    it('senha fora das regras é 400 e NÃO consome o token', async () => {
      const user = await newUser('Reset Regras');
      await forgot(user.email);
      const token = tokenFromEmail();
      expect((await reset(token, 'curta')).status).toBe(400);
      expect((await reset(token, 'x'.repeat(73))).status).toBe(400);
      expect((await reset(token)).status).toBe(201);
    });

    it('limita por IP: a 11ª tentativa seguida vira 429 (mesmo com token lixo) — trava adivinhação em massa', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await reset('a'.repeat(40))).status);
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('um token de redefinição NÃO abre sessão (não serve como Bearer)', async () => {
      const user = await newUser('Reset Bearer');
      await forgot(user.email);
      const token = tokenFromEmail();
      const me = await api().get('/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(401);
    });
  });

  describe('auditoria', () => {
    it('registra o pedido e a conclusão, sem senha nem token', async () => {
      const user = await newUser('Reset Auditoria');
      await forgot(user.email);
      await reset(tokenFromEmail());
      await new Promise((resolve) => setTimeout(resolve, 300)); // audit.log é fire-and-forget
      const rows = (
        await (db as any).client.query(
          `SELECT action, detail FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'password_reset_%' ORDER BY occurred_at`,
          [user.userId],
        )
      ).rows;
      expect(rows.map((r: any) => r.action)).toEqual(['password_reset_requested', 'password_reset_completed']);
      expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
    });
  });
});
