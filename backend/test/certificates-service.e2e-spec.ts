import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const FIXTURE_PATH = join(__dirname, 'fixtures/esocial/test-certificate.pfx');

describe('Certificates (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('faz upload, lista sem vazar segredo, e remove', async () => {
    const tenant = await db.createTenantWithUser('cert-basic');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const uploadRes = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`)
      .field('label', 'Certificado principal')
      .field('password', 'teste1234')
      .attach('file', pfxBuffer, 'test-certificate.pfx');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.subjectCn).toContain('EMPRESA TESTE LTDA');
    expect(uploadRes.body.status).toBe('ativo');
    expect(JSON.stringify(uploadRes.body)).not.toContain('teste1234');
    expect(uploadRes.body.encryptedPassword).toBeUndefined();
    expect(uploadRes.body.pfxR2Key).toBeUndefined();

    const listRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const removeRes = await request(app.getHttpServer())
      .delete(`/esocial/certificates/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(removeRes.status).toBe(200);
  });

  it('rejeita upload com senha errada sem persistir nada', async () => {
    const tenant = await db.createTenantWithUser('cert-wrong-pw');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const res = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`)
      .field('label', 'Certificado')
      .field('password', 'senha-errada')
      .attach('file', pfxBuffer, 'test-certificate.pfx');

    expect(res.status).toBe(400);

    const listRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(listRes.body).toHaveLength(0);
  });
});
