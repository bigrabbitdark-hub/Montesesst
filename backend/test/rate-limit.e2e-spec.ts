import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

// AUTH_RATE_LIMIT_MAX é lido pelo decorator @RateLimit em auth.controller.ts
// no momento em que o módulo é importado (não por request) — precisa estar
// definido no ambiente antes do processo Jest subir. Ver comando de teste em
// docs/operations/reliability.md.
const AUTH_LIMIT = parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '5', 10);

describe('Rate limiting em /auth/login (e2e)', () => {
  let app: INestApplication;
  const redis = new Redis(process.env.REDIS_URL as string);
  const usedKeys: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (usedKeys.length) await redis.del(...usedKeys);
    redis.disconnect();
    await app.close();
  });

  it(`bloqueia com 429 depois de ${AUTH_LIMIT} tentativas de login com o mesmo e-mail`, async () => {
    const email = `rate-limit-teste-${randomUUID()}@teste.montese.local`;
    usedKeys.push(`ratelimit:AuthController.login:::ffff:127.0.0.1:${email.toLowerCase()}`);

    const responses: request.Response[] = [];
    for (let i = 0; i < AUTH_LIMIT + 1; i++) {
      responses.push(
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'senha-errada' }),
      );
    }

    const withinLimit = responses.slice(0, AUTH_LIMIT);
    const overLimit = responses[AUTH_LIMIT];

    for (const res of withinLimit) {
      expect(res.status).toBe(401);
    }
    expect(overLimit.status).toBe(429);
    expect(overLimit.headers['retry-after']).toBeDefined();
    expect(Number(overLimit.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('não afeta tentativas de login com um e-mail diferente (isolamento por chave)', async () => {
    const emailA = `rate-limit-a-${randomUUID()}@teste.montese.local`;
    const emailB = `rate-limit-b-${randomUUID()}@teste.montese.local`;
    usedKeys.push(
      `ratelimit:AuthController.login:::ffff:127.0.0.1:${emailA.toLowerCase()}`,
      `ratelimit:AuthController.login:::ffff:127.0.0.1:${emailB.toLowerCase()}`,
    );

    for (let i = 0; i < AUTH_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emailA, password: 'senha-errada' });
    }

    const resA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailA, password: 'senha-errada' });
    const resB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailB, password: 'senha-errada' });

    expect(resA.status).toBe(429);
    expect(resB.status).toBe(401);
  });
});
