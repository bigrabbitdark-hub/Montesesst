import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { DOCUMENT_CLASSIFIER_PROVIDER } from '../src/documents/document-classifier-provider.interface';
import { DOCX_MIME_TYPE } from '../src/common/docx/docx-text.util';
import { TestDb, TestTenantFixture } from './db-test-helper';
import { TINY_PNG, bombDocx, buildZip } from './file-fixtures';

// ITEM 004 (auditoria 2026-09-27): o tipo do upload é conferido pelo CONTEÚDO,
// em cada ponto de entrada. Todas as rejeições abaixo acontecem ANTES de
// qualquer escrita no storage (não dependem do R2 estar configurado).

const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const ASSISTANT_RATE_LIMIT_KEY = 'ratelimit:NormativeAssistantController.query:::ffff:127.0.0.1';
const CLASSIFY_RATE_LIMIT_KEY = 'ratelimit:DocumentsController.classifyBatch:::ffff:127.0.0.1';

describe('Validação do conteúdo dos uploads (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let tenant: TestTenantFixture;
  let token: string;
  const fakeClassify = jest.fn();

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_CLASSIFIER_PROVIDER)
      .useValue({ classify: fakeClassify })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    redis = new Redis(process.env.REDIS_URL as string);
    db = new TestDb();
    await db.connect();
    tenant = await db.createTenantWithUser('Empresa Conteudo Upload');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;
  });

  beforeEach(async () => {
    fakeClassify.mockReset();
    await redis.del(ASSISTANT_RATE_LIMIT_KEY, CLASSIFY_RATE_LIMIT_KEY);
  });

  afterAll(async () => {
    await redis.del(ASSISTANT_RATE_LIMIT_KEY, CLASSIFY_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const documentCount = async (): Promise<number> =>
    Number((await (db as any).client.query('SELECT count(*) FROM documents WHERE tenant_id = $1', [tenant.tenantId])).rows[0].count);

  const postDocument = (file: Buffer, filename: string, contentType: string) =>
    request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'Teste de conteúdo')
      .attach('file', file, { filename, contentType });

  describe('POST /documents', () => {
    it('recusa HTML/script declarado como PDF e não cria documento', async () => {
      const res = await postDocument(HTML, 'pgr.pdf', 'application/pdf');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('não corresponde ao tipo informado (PDF)');
      expect(await documentCount()).toBe(0);
    });

    it('recusa imagem PNG declarada como PDF', async () => {
      const res = await postDocument(TINY_PNG, 'pgr.pdf', 'application/pdf');
      expect(res.status).toBe(400);
      expect(await documentCount()).toBe(0);
    });

    it('recusa ZIP qualquer declarado como DOCX (sem word/document.xml)', async () => {
      const zip = buildZip([{ name: 'programa.exe', data: Buffer.from('MZ') }]);
      const res = await postDocument(zip, 'pgr.docx', DOCX_MIME_TYPE);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('DOCX');
      expect(await documentCount()).toBe(0);
    });

    it('recusa zip bomb (250 MB descompactados num arquivo de poucos KB) rapidamente, sem criar documento', async () => {
      const bomb = bombDocx(250 * 1024 * 1024);
      expect(bomb.length).toBeLessThan(1024 * 1024); // o que trafega é pequeno

      const startedAt = Date.now();
      const res = await postDocument(bomb, 'bomba.docx', DOCX_MIME_TYPE);
      const elapsedMs = Date.now() - startedAt;

      expect(res.status).toBe(400);
      expect(elapsedMs).toBeLessThan(20_000);
      expect(await documentCount()).toBe(0);
    });
  });

  describe('POST /tenants/me/logo', () => {
    it('recusa HTML declarado como PNG', async () => {
      const res = await request(app.getHttpServer())
        .post('/tenants/me/logo')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', HTML, { filename: 'logo.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('não corresponde ao tipo informado (PNG)');
    });
  });

  describe('POST /fire-safety-equipment/:id/foto (antes não validava tipo nenhum)', () => {
    let equipmentId: string;
    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/fire-safety-equipment')
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo: 'extintor', codigo: 'EXT-CONTEUDO' });
      equipmentId = created.body.id;
    });

    it('recusa tipo fora de JPG/PNG (HTML enviado como text/html)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fire-safety-equipment/${equipmentId}/foto`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', HTML, { filename: 'foto.html', contentType: 'text/html' });
      expect(res.status).toBe(400);
    });

    it('recusa HTML declarado como JPEG', async () => {
      const res = await request(app.getHttpServer())
        .post(`/fire-safety-equipment/${equipmentId}/foto`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', HTML, { filename: 'foto.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('não corresponde ao tipo informado (JPG)');
    });
  });

  describe('POST /assistant/normative-query (anexo)', () => {
    it('recusa HTML declarado como PDF antes de mandar pro parser', async () => {
      const res = await request(app.getHttpServer())
        .post('/assistant/normative-query')
        .set('Authorization', `Bearer ${token}`)
        .field('question', 'o que diz este documento?')
        .attach('file', HTML, { filename: 'doc.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('não corresponde ao tipo informado (PDF)');
    });
  });

  describe('POST /documents/classify-batch', () => {
    it('trata PDF falso como "revisar manualmente" e NÃO chama o classificador de IA', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents/classify-batch')
        .set('Authorization', `Bearer ${token}`)
        .attach('files', HTML, { filename: 'falso.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].needs_review).toBe(true);
      expect(res.body[0].suggested_category).toBeNull();
      expect(fakeClassify).not.toHaveBeenCalled();
    });
  });
});
