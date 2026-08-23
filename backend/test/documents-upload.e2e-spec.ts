import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /documents — upload e listagem (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;
  let uploadedFileKey: string | undefined;
  let uploadedDocumentId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Documentos Upload Teste');
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
    if (uploadedFileKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
    }
    if (uploadedDocumentId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [uploadedDocumentId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('faz upload real de um PDF, salva no R2 de verdade, e aparece na listagem', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste', 'utf-8');

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR de teste')
      .attach('file', fakePdf, { filename: 'pgr-teste.pdf', contentType: 'application/pdf' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.category).toBe('pgr');
    uploadedFileKey = uploadRes.body.file_key;
    uploadedDocumentId = uploadRes.body.id;

    // Confirma que o objeto existe de verdade no R2, não só que o Postgres tem a linha
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }),
    );
    expect(head.ContentLength).toBe(fakePdf.length);

    const listRes = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(
      listRes.body.find((d: { file_key: string }) => d.file_key === uploadedFileKey),
    ).toBeDefined();
  });

  it('rejeita tipo de arquivo não permitido antes de tocar no R2', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'Arquivo ruim')
      .attach('file', Buffer.from('conteudo'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
  });
});
