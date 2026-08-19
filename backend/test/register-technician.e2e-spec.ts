import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

// Mesmo motivo do REGISTER_RATE_LIMIT_KEY em register.e2e-spec.ts — o
// contador de /auth/register-technician é isolado por rota (RateLimitGuard),
// mas ainda cumulativo entre os testes deste arquivo (mesmo IP de loopback).
const RATE_LIMIT_KEY = 'ratelimit:AuthController.registerTechnician:::ffff:127.0.0.1';

describe('Cadastro de técnico — POST /auth/register-technician (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let redis: Redis;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    fakeEmail.send.mockClear();
    await redis.del(RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await db.query('DELETE FROM users WHERE email = ANY($1)', [createdEmails]);
    }
    await redis.del(RATE_LIMIT_KEY);
    redis.disconnect();
    await db.end();
    await app.close();
  });

  it('cria user+technician pendentes, e dispara o e-mail de confirmação', async () => {
    const email = `tecnico-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);

    const res = await request(app.getHttpServer()).post('/auth/register-technician').send({
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Teste',
      phone: '48999990000',
      registration_number: 'REG-123',
      specialization: 'Segurança do Trabalho',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(email);

    const row = await db.query(
      `SELECT u.status AS user_status, t.status AS technician_status
       FROM users u JOIN technicians t ON t.user_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    expect(row.rows[0]).toMatchObject({ user_status: 'pendente', technician_status: 'pendente' });
  });

  it('rejeita e-mail duplicado com 409', async () => {
    const email = `dup-tec-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);
    const payload = {
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Duplicado',
    };
    await request(app.getHttpServer()).post('/auth/register-technician').send(payload).expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register-technician')
      .send(payload);
    expect(res.status).toBe(409);
  });

  it('confirma o e-mail e ativa technician+user; clicar duas vezes não quebra', async () => {
    const email = `confirmar-tec-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);

    await request(app.getHttpServer()).post('/auth/register-technician').send({
      email,
      password: 'senha-segura-123',
      full_name: 'Técnico Confirmar',
    });

    const confirmUrl: string = fakeEmail.send.mock.calls[0][0].html.match(/href="([^"]+)"/)[1];
    const token = new URL(confirmUrl).searchParams.get('token') as string;

    const first = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/cadastro/confirmado?status=ok');

    const row = await db.query(
      `SELECT u.status AS user_status, t.status AS technician_status
       FROM users u JOIN technicians t ON t.user_id = u.id WHERE u.email = $1`,
      [email],
    );
    expect(row.rows[0]).toMatchObject({ user_status: 'ativo', technician_status: 'ativo' });

    const second = await request(app.getHttpServer()).get('/auth/confirm').query({ token });
    expect(second.status).toBe(302);
    expect(second.headers.location).toBe('/cadastro/confirmado?status=ok');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'senha-segura-123' });
    expect(loginRes.status).toBe(201);
  });

  it('bloqueia com 429 depois do limite de cadastros por IP', async () => {
    const limit = parseInt(process.env.REGISTER_RATE_LIMIT_MAX ?? '5', 10);
    for (let i = 0; i < limit; i++) {
      const email = `rate-tec-${randomUUID()}@teste.montese.local`;
      createdEmails.push(email);
      await request(app.getHttpServer()).post('/auth/register-technician').send({
        email,
        password: 'senha-segura-123',
        full_name: 'Técnico Rate',
      });
    }
    const res = await request(app.getHttpServer()).post('/auth/register-technician').send({
      email: `estourou-tec-${randomUUID()}@teste.montese.local`,
      password: 'senha-segura-123',
      full_name: 'Técnico Estourou',
    });
    expect(res.status).toBe(429);
  });

  it('rejeita senha curta com 400 e não dispara e-mail', async () => {
    const email = `senha-curta-${randomUUID()}@teste.montese.local`;
    createdEmails.push(email);

    const res = await request(app.getHttpServer()).post('/auth/register-technician').send({
      email,
      password: 'abc',
      full_name: 'Técnico Senha Curta',
    });

    expect(res.status).toBe(400);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });
});
