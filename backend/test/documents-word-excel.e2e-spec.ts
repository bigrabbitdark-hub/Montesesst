import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { TestDb } from './db-test-helper';

async function buildTestXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ruído');
  sheet.addRow(['Função', 'Medição']);
  sheet.addRow(['Soldador', '92 dB(A)']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('POST /documents — upload de Word/Excel + indexação (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Word Excel Teste');
    tenantId = tenant.tenantId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query(
      'DELETE FROM company_document_chunks WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)',
      [tenantId],
    );
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('upload de PGR em .xlsx é aceito, salvo, e indexado em company_document_chunks', async () => {
    const xlsx = await buildTestXlsx();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR planilha de ruído')
      .attach('file', xlsx, {
        filename: 'pgr.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    const documentId = res.body.id;

    const chunks = await (db as any).client.query(
      'SELECT category, content FROM company_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunks.rows.length).toBeGreaterThan(0);
    expect(chunks.rows[0].category).toBe('pgr');
    expect(chunks.rows[0].content).toContain('Soldador');
  });

  it('upload de treinamento em .xlsx é aceito e salvo, mas NÃO é indexado (categoria fora das 4 centrais)', async () => {
    const xlsx = await buildTestXlsx();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'treinamento')
      .field('title', 'Treinamento planilha')
      .attach('file', xlsx, {
        filename: 'treinamento.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    const documentId = res.body.id;

    const chunks = await (db as any).client.query(
      'SELECT id FROM company_document_chunks WHERE document_id = $1',
      [documentId],
    );
    expect(chunks.rows.length).toBe(0);
  });
});
