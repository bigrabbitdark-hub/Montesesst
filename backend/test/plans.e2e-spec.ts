import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /plans (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lista todos os planos ativos sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/plans');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    expect(res.body.some((p: { slug: string }) => p.slug === 'empresa-start')).toBe(true);
  });

  it('filtra por audience', async () => {
    const res = await request(app.getHttpServer()).get('/plans').query({ audience: 'tecnico' });
    expect(res.status).toBe(200);
    expect(res.body.every((p: { audience: string }) => p.audience === 'tecnico')).toBe(true);
    expect(res.body.some((p: { slug: string }) => p.slug === 'tecnico-start')).toBe(true);
  });
});
