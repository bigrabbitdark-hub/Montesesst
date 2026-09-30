import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Cenário do release de 2026-09-30: o backend PRECISA subir sem GOOGLE_CLIENT_ID/SECRET.
// Usa o provider REAL (sem overrideProvider) — é o que garante que o AppModule inteiro instancia.
describe('Google Calendar sem credenciais OAuth (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let technicianUserId: string;
  let technicianToken: string;
  const originalId = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Google Sem Credencial Teste');
    technicianUserId = tech.userId;
    await (db as any).client.query('INSERT INTO technicians (user_id) VALUES ($1)', [tech.userId]);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: tech.email, password: tech.password });
    technicianToken = login.body.access_token;
  });

  afterAll(async () => {
    if (originalId !== undefined) process.env.GOOGLE_CLIENT_ID = originalId;
    if (originalSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = originalSecret;
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('o AppModule inicializa sem as credenciais (o backend sobe)', () => {
    expect(app).toBeDefined();
  });

  it('GET /google-calendar/status responde 200 com available:false e connected:false', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, available: false });
  });

  it('GET /google-calendar/auth-url responde 503 com código GOOGLE_NOT_CONFIGURED (não 500, não URL inválida)', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('GOOGLE_NOT_CONFIGURED');
    expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
  });

  it('a rota de callback não derruba nada: redireciona para erro', async () => {
    const res = await request(app.getHttpServer()).get('/google-calendar/callback?code=x&state=y');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('google=erro');
  });

  it('continua exigindo papel tecnico: empresa recebe 403 em /auth-url', async () => {
    const empresa = await db.createTenantWithUser('Empresa Google Sem Credencial Teste');
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: empresa.email, password: empresa.password });
    const res = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
