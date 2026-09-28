import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Achado durante o ITEM 022 (auditoria 2026-09-27): a JwtStrategy montava o
// usuário só com sub/tenantId/role de QUALQUER token com assinatura válida,
// sem olhar o claim `purpose`. Tokens de e-mail (confirmação de cadastro, 48h;
// redefinição de senha) são JWTs assinados com o mesmo segredo — então eram
// aceitos como Bearer de sessão, com `role` indefinida. Um token que existe
// para UMA ação enviada por e-mail nunca pode valer como login.
describe('Tokens com `purpose` não valem como sessão (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let jwt: JwtService;
  let tenantUserId: string;
  let sessionToken: string;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Token Purpose');
    tenantUserId = tenant.userId;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    sessionToken = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const me = (token: string) => request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);

  it('controle: o token de sessão normal continua valendo', async () => {
    const res = await me(sessionToken);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('empresa');
  });

  it('token de confirmação de e-mail (purpose) NÃO vale como sessão', async () => {
    const token = jwt.sign({ sub: tenantUserId, purpose: 'email_confirmation' }, { expiresIn: '48h' });
    expect((await me(token)).status).toBe(401);
  });

  it('token de redefinição de senha (purpose) NÃO vale como sessão', async () => {
    const token = jwt.sign({ sub: tenantUserId, purpose: 'password_reset' }, { expiresIn: '1h' });
    expect((await me(token)).status).toBe(401);
  });

  it('token assinado sem role (nem purpose) também não vale como sessão', async () => {
    const token = jwt.sign({ sub: tenantUserId }, { expiresIn: '1h' });
    expect((await me(token)).status).toBe(401);
  });

  it('token com role inventada fora dos 4 papéis conhecidos não vale', async () => {
    const token = jwt.sign({ sub: tenantUserId, tenantId: null, role: 'superuser' }, { expiresIn: '1h' });
    expect((await me(token)).status).toBe(401);
  });
});
