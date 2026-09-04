import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /documents — categorias LTCAT/LIP (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let s3: S3Client;
  const uploadedFileKeys: string[] = [];
  const uploadedDocumentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Documentos Tecnicos Teste');

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
    for (const key of uploadedFileKeys) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    }
    if (uploadedDocumentIds.length > 0) {
      await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [uploadedDocumentIds]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('aceita upload real com categoria ltcat', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste ltcat', 'utf-8');

    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'ltcat')
      .field('title', 'LTCAT de teste')
      .attach('file', fakePdf, { filename: 'ltcat-teste.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.category).toBe('ltcat');
    uploadedFileKeys.push(res.body.file_key);
    uploadedDocumentIds.push(res.body.id);
  });

  it('aceita upload real com categoria lip', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste lip', 'utf-8');

    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'lip')
      .field('title', 'LIP de teste')
      .attach('file', fakePdf, { filename: 'lip-teste.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.category).toBe('lip');
    uploadedFileKeys.push(res.body.file_key);
    uploadedDocumentIds.push(res.body.id);
  });
});
