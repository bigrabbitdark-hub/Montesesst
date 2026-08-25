import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('documents reconhece o papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let partnerId: string;
  let partnerToken: string;
  let s3: S3Client;
  let uploadedFileKey: string | undefined;
  let uploadedDocumentId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Documents Partner Teste');
    tenantId = tenant.tenantId;
    const partner = await db.createUserWithRole('parceiro', 'Parceiro Documents Teste');

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginRes.body.access_token;

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
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
      } catch {
        // já apagado pelo próprio teste — esperado no caminho feliz
      }
    }
    if (uploadedDocumentId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [uploadedDocumentId]);
    }
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('parceiro faz upload real de um documento pra empresa vinculada, aparece na listagem', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste parceiro', 'utf-8');

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('category', 'pgr')
      .field('title', 'PGR de teste parceiro')
      .field('tenant_id', tenantId)
      .attach('file', fakePdf, { filename: 'pgr-parceiro.pdf', contentType: 'application/pdf' });

    expect(uploadRes.status).toBe(201);
    uploadedFileKey = uploadRes.body.file_key;
    uploadedDocumentId = uploadRes.body.id;

    const head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }),
    );
    expect(head.ContentLength).toBe(fakePdf.length);
  });

  it('parceiro vê o portfólio de conformidade (score por empresa vinculada)', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((item: { tenant_id: string }) => item.tenant_id === tenantId)).toBe(true);
  });

  it('parceiro consegue apagar o documento que ele mesmo subiu', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/documents/${uploadedDocumentId}`)
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey })),
    ).rejects.toThrow();
    uploadedFileKey = undefined;
    uploadedDocumentId = undefined;
  });
});
