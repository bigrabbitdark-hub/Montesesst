import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GOOGLE_CALENDAR_CLIENT } from '../src/google-calendar/google-calendar-client.interface';
import { TestDb } from './db-test-helper';

describe('Google Calendar — status/conexão/desconexão (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let technicianUserId: string;
  let technicianToken: string;

  const fakeExchangeCode = jest.fn();
  const fakeGetUserEmail = jest.fn();
  const fakeGoogleClient = {
    getAuthUrl: jest.fn((state: string) => `https://accounts.google.com/o/oauth2/fake?state=${state}`),
    exchangeCode: fakeExchangeCode,
    getUserEmail: fakeGetUserEmail,
    refreshAccessToken: jest.fn(),
    insertEvent: jest.fn(),
  };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    // O google-oauth-calendar-client.service.ts valida essas duas no
    // constructor (F-27) — sem elas o provider registrado em
    // google-calendar.module.ts:11 aborta o boot do módulo antes do
    // .overrideProvider(GOOGLE_CALENDAR_CLIENT) ter efeito. Os valores
    // aqui não precisam bater com credencial real porque o provider todo
    // é substituído pelo fakeGoogleClient no .useValue abaixo.
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_CALENDAR_CLIENT)
      .useValue(fakeGoogleClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Google Teste');
    technicianUserId = tech.userId;
    await (db as any).client.query('INSERT INTO technicians (user_id) VALUES ($1)', [tech.userId]);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = login.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM technician_google_accounts WHERE technician_user_id = $1', [
      technicianUserId,
    ]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('status inicial: não conectado', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('gera uma URL de autorização', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('accounts.google.com');
  });

  it('callback com state válido conecta a conta e status passa a refletir isso', async () => {
    fakeExchangeCode.mockResolvedValue({
      refreshToken: 'refresh-fake-123',
      accessToken: 'access-fake-123',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    fakeGetUserEmail.mockResolvedValue('tecnico@gmail.com');

    const authUrlRes = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);
    const url = new URL(authUrlRes.body.url);
    const state = url.searchParams.get('state');

    const callbackRes = await request(app.getHttpServer()).get(
      `/google-calendar/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
    );
    expect(callbackRes.status).toBe(302);

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: true, google_email: 'tecnico@gmail.com' });
  });

  it('desconectar remove a conta', async () => {
    const res = await request(app.getHttpServer())
      .delete('/google-calendar/desconectar')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(res.status).toBe(200);

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: false });
  });

  it('callback com state inválido não conecta nada', async () => {
    const res = await request(app.getHttpServer()).get(
      '/google-calendar/callback?code=fake-code&state=lixo-invalido',
    );
    expect(res.status).toBe(302); // redireciona pro erro, não derruba a request

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: false });
  });
});
