import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { BCRYPT_COST } from '../src/common/auth/bcrypt-cost';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /documents/:id/download, DELETE /documents/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;
  let documentId: string;
  let fileKey: string;
  const fileContent = '%PDF-1.4 conteudo de teste download';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Download Delete Teste');
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

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'laudo')
      .field('title', 'Laudo de teste download')
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'laudo.pdf',
        contentType: 'application/pdf',
      });
    documentId = uploadRes.body.id;
    fileKey = uploadRes.body.file_key;
  });

  afterAll(async () => {
    // Se o teste de delete não rodou/falhou antes de apagar, garante limpeza mesmo assim.
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey }));
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey }));
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    } catch {
      // já foi apagado pelo próprio teste — esperado no caminho feliz
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('gera uma URL assinada real que baixa o conteúdo correto', async () => {
    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain(process.env.R2_ACCOUNT_ID);

    const downloadRes = await fetch(res.body.url);
    const downloadedContent = await downloadRes.text();
    expect(downloadedContent).toBe(fileContent);
  });

  it('rejeita exclusão por quem não subiu o documento (mesmo tenant, outro usuário)', async () => {
    const otherPassword = 'senha-teste-123';
    const passwordHash = await bcrypt.hash(otherPassword, BCRYPT_COST);
    const otherEmail = `outro-usuario-${randomUUID()}@teste.montese.local`;
    await (db as any).client.query(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES ($1, 'empresa', $2, $3, 'Outro Usuario Empresa', 'ativo')`,
      [tenantId, otherEmail, passwordHash],
    );

    const loginOther = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherEmail, password: otherPassword });

    const res = await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${loginOther.body.access_token}`);

    expect(res.status).toBe(403);

    await (db as any).client.query('DELETE FROM users WHERE email = $1', [otherEmail]);
  });

  it('quem subiu consegue apagar, e o objeto some do R2 de verdade', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    await expect(
      s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey })),
    ).rejects.toThrow();
  });
});
