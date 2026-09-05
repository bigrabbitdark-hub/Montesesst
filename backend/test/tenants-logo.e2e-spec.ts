import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/DELETE /tenants/me/logo, GET /tenants/:id/logo (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Logo Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  });

  afterAll(async () => {
    // Limpeza defensiva — o teste de remoção já deveria ter zerado a
    // coluna, mas garante que nenhum logo_file_key sobra caso algum
    // teste falhe no meio.
    await (db as any).client.query('UPDATE tenants SET logo_file_key = NULL WHERE id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita tipo de arquivo não permitido (PDF)', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4 conteudo'), { filename: 'logo.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('faz upload real de PNG, GET /tenants/me passa a devolver has_logo true', async () => {
    const fakePng = Buffer.from('fake png bytes');
    const uploadRes = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', fakePng, { filename: 'logo.png', contentType: 'image/png' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.has_logo).toBe(true);

    const meRes = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.has_logo).toBe(true);
  });

  it('GET /tenants/:id/logo (sem autenticação nenhuma) redireciona pra uma URL real do R2', async () => {
    const res = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(process.env.R2_ENDPOINT?.replace('https://', '') ?? '');
  });

  it('GET /tenants/:id/logo devolve 404 (não 500) pra um :id que não é um UUID válido', async () => {
    const res = await request(app.getHttpServer()).get('/tenants/nao-e-um-uuid/logo');

    expect(res.status).toBe(404);
  });

  it('GET /tenants/:id/logo devolve 404 pra tenant sem logo', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Sem Logo Teste');

    const res = await request(app.getHttpServer()).get(`/tenants/${otherTenant.tenantId}/logo`);

    expect(res.status).toBe(404);

    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [otherTenant.tenantId]);
    await (db as any).client.query('DELETE FROM users WHERE id = $1', [otherTenant.userId]);
  });

  it('trocar a logo apaga o objeto antigo do R2 de verdade, não só substitui a referência', async () => {
    const beforeKey = (
      await (db as any).client.query('SELECT logo_file_key FROM tenants WHERE id = $1', [tenantId])
    ).rows[0].logo_file_key;
    expect(beforeKey).not.toBeNull();

    // Confirma que o objeto ANTIGO existe de verdade no R2 antes de trocar.
    await expect(s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: beforeKey }))).resolves.toBeDefined();

    const secondPng = Buffer.from('outra imagem fake');
    const res = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', secondPng, { filename: 'logo2.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.has_logo).toBe(true);

    const afterKey = (
      await (db as any).client.query('SELECT logo_file_key FROM tenants WHERE id = $1', [tenantId])
    ).rows[0].logo_file_key;
    expect(afterKey).not.toBe(beforeKey);

    const getRes = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);
    expect(getRes.status).toBe(302);

    // O objeto ANTIGO precisa ter sido apagado de verdade do R2 — não só
    // desreferenciado na coluna. HeadObjectCommand rejeita (404/NotFound)
    // pra um objeto que não existe mais.
    await expect(s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: beforeKey }))).rejects.toThrow();
  });

  it('DELETE /tenants/me/logo remove a logo — GET /tenants/me volta a devolver has_logo false', async () => {
    const deleteRes = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.has_logo).toBe(false);

    const meRes = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.body.has_logo).toBe(false);

    const getRes = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /tenants/me/logo sem logo nenhuma é um no-op (200, não erro)', async () => {
    const res = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.has_logo).toBe(false);
  });

  it('bloqueia role sem permissão (tecnico) no upload/remoção com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Logo Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const tecnicoToken = loginRes.body.access_token;

    const uploadRes = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${tecnicoToken}`)
      .attach('file', Buffer.from('fake'), { filename: 'logo.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(403);

    const deleteRes = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${tecnicoToken}`);
    expect(deleteRes.status).toBe(403);
  });
});
