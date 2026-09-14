import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
import { DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER } from '../src/pente-fino/document-checklist-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// Mesmo motivo de pente-fino-run.e2e-spec.ts: contador próprio por
// rota, teto baixo (5/hora) — sem zerar, o 6º request deste arquivo
// receberia 429 em vez do status esperado.
const RATE_LIMIT_KEY = 'ratelimit:PenteFinoController.run:::ffff:127.0.0.1';

function buildTestPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text(text);
    doc.end();
  });
}

const EMPTY_CHECKLIST = {
  elaboration_date: '',
  elaboration_date_excerpt: '',
  professional_name: '',
  professional_registro: '',
  professional_papel: '',
  professional_excerpt: '',
};

describe('POST /pente-fino/run — checklist preliminar (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tenantId: string;
  let userId: string;
  const fakeExtractFunction = jest.fn();
  const fakeExtractChecklist = jest.fn();
  const fakeGetObject = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FUNCTION_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtractFunction })
      .overrideProvider(DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER)
      .useValue({ extract: fakeExtractChecklist })
      .overrideProvider(R2Service)
      .useValue({ getObject: fakeGetObject })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(RATE_LIMIT_KEY);

    db = new TestDb();
    await db.connect();
    // createTenantWithUser já devolve userId — nunca reconsultar isso
    // via SELECT solto em users, mesma disciplina do resto da suíte.
    const tenant = await db.createTenantWithUser('Empresa Pente-Fino Checklist Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await redis.del(RATE_LIMIT_KEY);
    await redis.quit();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('extrai data e profissional pra PGR/PCMSO/LTCAT/LIP, e LTCAT/LIP ausentes não geram warning', async () => {
    const client = (db as any).client;

    // Só PGR e LTCAT existem nesta empresa — PCMSO e LIP ficam
    // ausentes de propósito, pra provar que warning só existe pro par
    // PGR/PCMSO e nunca pra LTCAT/LIP.
    const pgrDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Checklist Teste', 'fixture/pgr-checklist.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    const ltcatDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'ltcat', 'LTCAT Checklist Teste', 'fixture/ltcat-checklist.pdf', 'ltcat.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    fakeGetObject.mockResolvedValue(
      await buildTestPdf(
        'PGR elaborado em 10 de janeiro de 2024. Responsável: Maria Souza, CREA-99999, Engenheira de Segurança do Trabalho.',
      ),
    );
    fakeExtractFunction.mockResolvedValue([]);
    fakeExtractChecklist.mockResolvedValue({
      elaboration_date: '2024-01-10',
      elaboration_date_excerpt: 'elaborado em 10 de janeiro de 2024',
      professional_name: 'Maria Souza',
      professional_registro: 'CREA-99999',
      professional_papel: 'Engenheira de Segurança do Trabalho',
      professional_excerpt: 'Maria Souza, CREA-99999, Engenheira de Segurança do Trabalho',
    });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.pgr_document).toMatchObject({
      id: pgrDoc.rows[0].id,
      elaboration_date: '2024-01-10',
      elaboration_date_source_excerpt: 'elaborado em 10 de janeiro de 2024',
      professional_name: 'Maria Souza',
      professional_registro: 'CREA-99999',
      professional_papel: 'Engenheira de Segurança do Trabalho',
    });
    expect(res.body.ltcat_document).toMatchObject({ id: ltcatDoc.rows[0].id });
    expect(res.body.pcmso_document).toBeNull();
    expect(res.body.lip_document).toBeNull();

    // PCMSO ausente gera warning; LTCAT/LIP ausentes NÃO geram warning
    // (decisão da spec §2) — esta é a asserção que prova a decisão.
    expect(res.body.warnings.some((w: string) => w.includes('PCMSO'))).toBe(true);
    expect(res.body.warnings.some((w: string) => w.toUpperCase().includes('LTCAT'))).toBe(false);
    expect(res.body.warnings.some((w: string) => w.toUpperCase().includes('LIP'))).toBe(false);

    await client.query('DELETE FROM documents WHERE id = ANY($1)', [[pgrDoc.rows[0].id, ltcatDoc.rows[0].id]]);
  });

  it('reaproveita o cache — segunda chamada não invoca a IA de novo', async () => {
    const client = (db as any).client;
    const pcmsoDoc = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Cache Teste', 'fixture/pcmso-cache.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    fakeGetObject.mockResolvedValue(await buildTestPdf('PCMSO sem data nem profissional identificáveis.'));
    fakeExtractFunction.mockResolvedValue([]);
    fakeExtractChecklist.mockResolvedValue(EMPTY_CHECKLIST);
    fakeExtractChecklist.mockClear();

    const first = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(first.status).toBe(201);
    expect(fakeExtractChecklist).toHaveBeenCalledTimes(1);

    const second = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(second.status).toBe(201);
    // Segunda chamada reaproveita o cache — nenhuma chamada NOVA ao
    // provider de checklist pro mesmo documento.
    expect(fakeExtractChecklist).toHaveBeenCalledTimes(1);
    expect(second.body.pcmso_document.elaboration_date).toBeNull();

    await client.query('DELETE FROM documents WHERE id = $1', [pcmsoDoc.rows[0].id]);
  });

  it('técnico não vinculado recebe 403 sem vazar nenhum dado de checklist da empresa', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Checklist Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .post('/pente-fino/run')
      .set('Authorization', `Bearer ${loginTecnico.body.access_token}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('CREA');
  });
});
