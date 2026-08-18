import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';

// Mesmo motivo do REGISTER_RATE_LIMIT_KEY em register.e2e-spec.ts — o
// contador de /contact é isolado por rota (RateLimitGuard), mas ainda
// cumulativo entre os testes deste arquivo (mesmo IP de loopback).
const CONTACT_RATE_LIMIT_KEY = 'ratelimit:ContactController.create:::ffff:127.0.0.1';

describe('Contato — POST /contact (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  const fakeEmail = { send: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    fakeEmail.send.mockClear();
    await redis.del(CONTACT_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    await redis.del(CONTACT_RATE_LIMIT_KEY);
    redis.disconnect();
    await app.close();
  });

  it('envia a mensagem por e-mail e devolve 201', async () => {
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'Visitante Teste',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem de teste com mais de dez caracteres.',
    });

    expect(res.status).toBe(201);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send.mock.calls[0][0].to).toBe(process.env.CONTACT_EMAIL_TO);
    expect(fakeEmail.send.mock.calls[0][0].html).toContain('Visitante Teste');
  });

  it('escapa HTML no nome e na mensagem (proteção contra injeção)', async () => {
    await request(app.getHttpServer()).post('/contact').send({
      name: '<script>alert(1)</script>',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem com <b>html</b> de propósito, mais de dez caracteres.',
    });

    const html = fakeEmail.send.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejeita mensagem muito curta com 400', async () => {
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'Visitante',
      email: 'visitante@teste.montese.local',
      message: 'curta',
    });
    expect(res.status).toBe(400);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });

  it('bloqueia com 429 depois do limite por IP', async () => {
    const limit = parseInt(process.env.CONTACT_RATE_LIMIT_MAX ?? '10', 10);
    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer()).post('/contact').send({
        name: `Teste ${i}`,
        email: 'visitante@teste.montese.local',
        message: 'Mensagem de teste com mais de dez caracteres.',
      });
    }
    const res = await request(app.getHttpServer()).post('/contact').send({
      name: 'Estourou',
      email: 'visitante@teste.montese.local',
      message: 'Mensagem de teste com mais de dez caracteres.',
    });
    expect(res.status).toBe(429);
  });
});
