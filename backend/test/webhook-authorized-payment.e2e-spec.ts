import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /payments/mercadopago/webhook - subscription_authorized_payment (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejeita notificacao subscription_authorized_payment sem assinatura valida', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'payment-fake-123', type: 'subscription_authorized_payment' })
      .send({});

    expect(res.status).toBe(401);
  });
});
