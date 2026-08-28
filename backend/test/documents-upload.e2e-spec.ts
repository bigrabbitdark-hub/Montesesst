import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

  it('aceita company_unit_id da própria empresa e rejeita de outra empresa', async () => {
    const ownUnit = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz', 'Rua Teste', 'Porto Alegre', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    const ownUnitId = ownUnit.rows[0].id;

    const otherTenant = await db.createTenantWithUser('Empresa Documentos Upload Outra Teste');
    const otherUnit = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz', 'Rua Outra', 'Curitiba', 'PR', '80000000') RETURNING id`,
      [otherTenant.tenantId],
    );
    const otherUnitId = otherUnit.rows[0].id;

    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste', 'utf-8');

    const okRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR da matriz')
      .field('company_unit_id', ownUnitId)
      .attach('file', fakePdf, { filename: 'pgr-matriz.pdf', contentType: 'application/pdf' });

    expect(okRes.status).toBe(201);
    expect(okRes.body.company_unit_id).toBe(ownUnitId);

    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: okRes.body.file_key }));
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [okRes.body.id]);

    const crossTenantRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'Não deveria salvar')
      .field('company_unit_id', otherUnitId)
      .attach('file', fakePdf, { filename: 'pgr-invalido.pdf', contentType: 'application/pdf' });

    expect(crossTenantRes.status).toBe(400);

    await (db as any).client.query('DELETE FROM company_units WHERE id = ANY($1)', [[ownUnitId, otherUnitId]]);
    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [otherTenant.tenantId]);
    await (db as any).client.query('DELETE FROM users WHERE id = $1', [otherTenant.userId]);
  });

  it('sanitiza o nome do arquivo na chave do R2, neutralizando tentativa de path traversal', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste traversal', 'utf-8');

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR com nome malicioso')
      .attach('file', fakePdf, { filename: '../../evil.pdf', contentType: 'application/pdf' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.file_key).not.toContain('..');
    expect(uploadRes.body.file_key).toMatch(new RegExp(`^tenants/${tenantId}/documents/`));

    // Limpeza: objeto real no R2 + linha real no Postgres, mesmo padrão do teste acima
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadRes.body.file_key }));
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [uploadRes.body.id]);
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

  it('não deixa objeto órfão no R2 quando o INSERT é rejeitado pela RLS (técnico não vinculado)', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const tecnicoToken = loginRes.body.access_token;

    const prefix = `tenants/${tenantId}/documents/`;

    // Nota: o teste do primeiro `it()` deste describe já fez um upload real
    // bem-sucedido sob esse mesmo `tenantId` (só é limpo no `afterAll`), então
    // o prefixo pode não estar vazio aqui — o que importa é que a contagem
    // não aumenta com a tentativa rejeitada pela RLS, ou seja, nenhum objeto
    // NOVO (órfão) fica para trás.
    const before = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: prefix }),
    );
    const beforeCount = before.KeyCount ?? before.Contents?.length ?? 0;

    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${tecnicoToken}`)
      .field('tenant_id', tenantId)
      .field('category', 'pgr')
      .field('title', 'Tentativa de upload sem vínculo')
      .attach('file', Buffer.from('%PDF-1.4 conteudo de teste', 'utf-8'), {
        filename: 'pgr-sem-vinculo.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(403);

    const after = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: prefix }),
    );
    const afterCount = after.KeyCount ?? after.Contents?.length ?? 0;
    expect(afterCount).toBe(beforeCount);
  });
});
