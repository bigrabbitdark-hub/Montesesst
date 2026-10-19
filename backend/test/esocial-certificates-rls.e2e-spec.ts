import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Teste dedicado de RLS para `esocial_certificates` (Task 12). Garante que:
// 1. Tenant A não vê na listagem certificados do Tenant B (policy USING filtra).
// 2. Tenant A recebe 404 (não 403) ao tentar remover um certificado do Tenant B —
//    info-leak prevention: o RLS faz o UPDATE afetar 0 linhas, e o service
//    traduz `rowCount === 0` em NotFoundException, parecendo que o id não existe.
//
// Adaptado do brief oficial para o padrão real do projeto: login via
// `POST /auth/login` com `{ email, password }` da fixture, em vez de
// `tenant.token` direto (campo inexistente em TestTenantFixture).
describe('esocial_certificates RLS (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function login(tenant: { email: string; password: string }): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    return res.body.access_token;
  }

  it('tenant A não vê certificado do tenant B na listagem', async () => {
    const tenantA = await db.createTenantWithUser('cert-rls-a');
    const tenantB = await db.createTenantWithUser('cert-rls-b');
    await db.insertMinimalCertificate(tenantB);

    const tokenA = await login(tenantA);
    const res = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);

    // Sanity check (cross-tenant via superuser): o certificado do tenantB realmente
    // existe no banco. Se este expect falhar, o problema é a fixture, não o RLS.
    const tenantBListRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${await login(tenantB)}`);
    expect(tenantBListRes.body).toHaveLength(1);
  });

  it('tenant A não consegue remover certificado do tenant B (404, não 403)', async () => {
    const tenantA = await db.createTenantWithUser('cert-rls-remove-a');
    const tenantB = await db.createTenantWithUser('cert-rls-remove-b');
    const certId = await db.insertMinimalCertificate(tenantB);

    const tokenA = await login(tenantA);
    const res = await request(app.getHttpServer())
      .delete(`/esocial/certificates/${certId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // 404 (não 403): RLS bloqueia o UPDATE, rowCount===0, service lança NotFoundException.
    // Parecer "não existe" é melhor do que "existe mas você não pode" — info-leak prevention.
    expect(res.status).toBe(404);

    // Sanity check: o certificado do tenantB continua existindo e ativo.
    const tenantBListRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${await login(tenantB)}`);
    expect(tenantBListRes.body).toHaveLength(1);
    expect(tenantBListRes.body[0].id).toBe(certId);
    expect(tenantBListRes.body[0].status).toBe('ativo');
  });
});