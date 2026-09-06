import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { DOCUMENT_CLASSIFIER_PROVIDER } from '../src/documents/document-classifier-provider.interface';
import { TestDb } from './db-test-helper';

// Mesmo motivo do RATE_LIMIT_KEY em register-technician.e2e-spec.ts — o
// contador de /documents/classify-batch é isolado por rota (RateLimitGuard),
// mas ainda cumulativo entre os testes deste arquivo (mesmo IP de loopback).
const RATE_LIMIT_KEY = 'ratelimit:DocumentsController.classifyBatch:::ffff:127.0.0.1';

function buildTestPdf(text: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (text) doc.text(text);
    doc.end();
  });
}

describe('POST /documents/classify-batch (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  const fakeClassify = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_CLASSIFIER_PROVIDER)
      .useValue({ classify: fakeClassify })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Classify Batch Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    await redis.del(RATE_LIMIT_KEY);
  });

  afterEach(() => {
    fakeClassify.mockReset();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await redis.del(RATE_LIMIT_KEY);
    redis.disconnect();
    await app.close();
  });

  it('classifica um PDF com texto e devolve a sugestão da IA', async () => {
    fakeClassify.mockResolvedValue({
      category: 'pgr',
      title: 'PGR 2026',
      expires_at: '2027-01-01',
      confidence: 'alta',
    });
    const pdf = await buildTestPdf('PGR da empresa, válido até 01/01/2027');

    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', pdf, { filename: 'pgr.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      {
        filename: 'pgr.pdf',
        suggested_category: 'pgr',
        suggested_title: 'PGR 2026',
        suggested_expires_at: '2027-01-01',
        needs_review: false,
      },
    ]);
    expect(fakeClassify).toHaveBeenCalledTimes(1);
  });

  it('PDF sem texto (escaneado) não chama a IA, marca needs_review', async () => {
    const pdfSemTexto = await buildTestPdf(null);

    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', pdfSemTexto, { filename: 'escaneado.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      {
        filename: 'escaneado.pdf',
        suggested_category: null,
        suggested_title: null,
        suggested_expires_at: null,
        needs_review: true,
      },
    ]);
    expect(fakeClassify).not.toHaveBeenCalled();
  });

  it('arquivo não-PDF não chama a IA, marca needs_review', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('conteudo qualquer'), { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      {
        filename: 'foto.png',
        suggested_category: null,
        suggested_title: null,
        suggested_expires_at: null,
        needs_review: true,
      },
    ]);
    expect(fakeClassify).not.toHaveBeenCalled();
  });

  it('falha ao classificar um arquivo não impede os demais do lote', async () => {
    fakeClassify
      .mockRejectedValueOnce(new Error('falha simulada da MiniMax'))
      .mockResolvedValueOnce({ category: 'ltcat', title: 'LTCAT 2026', expires_at: '', confidence: 'alta' });
    const pdf1 = await buildTestPdf('primeiro documento');
    const pdf2 = await buildTestPdf('segundo documento');

    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', pdf1, { filename: 'falha.pdf', contentType: 'application/pdf' })
      .attach('files', pdf2, { filename: 'ok.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      { filename: 'falha.pdf', suggested_category: null, suggested_title: null, suggested_expires_at: null, needs_review: true },
      { filename: 'ok.pdf', suggested_category: 'ltcat', suggested_title: 'LTCAT 2026', suggested_expires_at: null, needs_review: false },
    ]);
  });

  it('sem nenhum arquivo devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('bloqueia role sem permissão (admin) com 403', async () => {
    const admin = await db.createUserWithRole('admin', 'Admin Classify Batch Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    const pdf = await buildTestPdf('texto qualquer');

    const res = await request(app.getHttpServer())
      .post('/documents/classify-batch')
      .set('Authorization', `Bearer ${loginAdmin.body.access_token}`)
      .attach('files', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });
});
