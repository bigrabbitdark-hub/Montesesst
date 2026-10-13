import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// E-19: R2 simulado em memória. Sem isto o upload dava 500 (R2 falso) ou, com credencial real, gravaria
// o .pfx cifrado de teste no bucket de produção.
const r2Store = new Map<string, Buffer>();
const fakeR2 = {
  putObject: async (k: string, b: Buffer) => void r2Store.set(k, b),
  getObject: async (k: string) => r2Store.get(k)!,
};

const FIXTURE_PATH = join(__dirname, 'fixtures/esocial/test-certificate.pfx');

describe('Certificates (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).compile();
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

  // Helper: cria tenant + usuário 'empresa', faz login via /auth/login, devolve token.
  // Mesmo padrão usado em aso.e2e-spec.ts e fire-brigade.e2e-spec.ts: nunca confiar
  // em `tenant.token` direto (campo inexistente em TestTenantFixture).
  async function loginAsEmpresa(namePrefix: string): Promise<{ token: string; tenant: Awaited<ReturnType<TestDb['createTenantWithUser']>> }> {
    const tenant = await db.createTenantWithUser(namePrefix);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    return { token: res.body.access_token, tenant };
  }

  it('faz upload, lista sem vazar segredo, e remove', async () => {
    const { token, tenant } = await loginAsEmpresa('cert-basic');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const uploadRes = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const removeRes = await request(app.getHttpServer())
      .delete(`/esocial/certificates/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removeRes.status).toBe(200);
    // cleanup de tenant só acontece no afterAll — o certificado removido é descartado
    // em CASCADE junto com o tenant via `tenants.id ON DELETE CASCADE`.
    void tenant;
  });

  it('rejeita upload com senha errada sem persistir nada', async () => {
    const { token } = await loginAsEmpresa('cert-wrong-pw');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const res = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${token}`)
      .field('label', 'Certificado')
      .field('password', 'senha-errada')
      .attach('file', pfxBuffer, 'test-certificate.pfx');

    expect(res.status).toBe(400);

    const listRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body).toHaveLength(0);
  });
});
