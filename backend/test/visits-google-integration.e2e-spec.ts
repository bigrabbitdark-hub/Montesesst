import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GOOGLE_CALENDAR_CLIENT } from '../src/google-calendar/google-calendar-client.interface';
import { TestDb } from './db-test-helper';

describe('Confirmar visita cria evento no Google Calendar (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let technicianUserId: string;
  let technicianToken: string;

  const fakeInsertEvent = jest.fn();
  const fakeGoogleClient = {
    getAuthUrl: jest.fn((state: string) => `https://accounts.google.com/fake?state=${state}`),
    exchangeCode: jest.fn().mockResolvedValue({
      refreshToken: 'refresh-fake',
      accessToken: 'access-fake',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    getUserEmail: jest.fn().mockResolvedValue('tecnico@gmail.com'),
    refreshAccessToken: jest.fn().mockResolvedValue({
      accessToken: 'access-fake-renovado',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    insertEvent: fakeInsertEvent,
  };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'c'.repeat(64);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_CALENDAR_CLIENT)
      .useValue(fakeGoogleClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Google Integration Teste');
    tenantId = tenant.tenantId;
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Google Integration Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, techResult.rows[0].id],
    );
    const techLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = techLogin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query(
      'DELETE FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico SEM Google conectado: confirmação funciona normalmente, sem evento', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-01',
        preferred_time: '10:00',
        motivo: 'Reunião sem Google conectado',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-01', confirmed_time: '10:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.google_event_id).toBeNull();
    expect(fakeInsertEvent).not.toHaveBeenCalled();
  });

  it('técnico COM Google conectado, tipo reunião: confirmação cria evento com Meet', async () => {
    // Conecta o Google via callback real (com o client mockado)
    const authUrlRes = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);
    const state = new URL(authUrlRes.body.url).searchParams.get('state');
    await request(app.getHttpServer()).get(
      `/google-calendar/callback?code=fake&state=${encodeURIComponent(state ?? '')}`,
    );

    fakeInsertEvent.mockResolvedValue({ eventId: 'evt-123', meetLink: 'https://meet.google.com/abc-defg-hij' });

    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-02',
        preferred_time: '14:00',
        motivo: 'Reunião com Google conectado',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-02', confirmed_time: '14:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.google_event_id).toBe('evt-123');
    expect(confirmRes.body.google_meet_link).toBe('https://meet.google.com/abc-defg-hij');
    expect(fakeInsertEvent).toHaveBeenCalledWith(
      'access-fake-renovado',
      expect.objectContaining({ createMeetLink: true }),
    );
  });

  it('Google falha ao criar evento: confirmação continua de pé, sem evento', async () => {
    fakeInsertEvent.mockRejectedValue(new Error('Google fora do ar (simulado)'));

    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-03',
        preferred_time: '09:00',
        motivo: 'Reunião com Google falhando',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-03', confirmed_time: '09:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.google_event_id).toBeNull();
  });
});
