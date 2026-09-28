import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestTenantFixture } from './db-test-helper';

// ITEM 003 (auditoria 2026-09-27), de ponta a ponta: um upload real de PGR
// passa pelo controller, que busca os nomes de funcionários do tenant e os
// entrega ao indexador. Prova (a) o que chega ao provedor externo de embedding
// e (b) o que fica persistido em company_document_chunks (que depois volta
// no prompt do Assistente).

function buildPdf(text: string): Promise<Buffer> {
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

const norm = (text: string) => text.replace(/\s+/g, ' ');

describe('Upload de PGR — minimização de PII antes do provedor externo (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0));

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      // Este spec é sobre PII, não sobre storage: o R2 é substituído por um
      // fake em memória (nenhum objeto é gravado em bucket algum).
      .overrideProvider(R2Service)
      .useValue({ putObject: jest.fn().mockResolvedValue(undefined), deleteObject: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    tenantA = await db.createTenantWithUser('Empresa PII A');
    tenantB = await db.createTenantWithUser('Empresa PII B');
    await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Marcos Antonio Pereira', '55500011122', 'ativo')`,
      [tenantA.tenantId],
    );
    await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Beatriz Cristina Lopes', '55500011133', 'ativo')`,
      [tenantB.tenantId],
    );
  });

  beforeEach(() => fakeEmbed.mockClear());

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function uploadPgr(tenant: TestTenantFixture, text: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;
    const pdf = await buildPdf(text);
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR PII e2e')
      .attach('file', pdf, { filename: 'pgr.pdf', contentType: 'application/pdf' });
    return res;
  }

  async function storedChunkText(documentId: string): Promise<string> {
    const rows = await (db as any).client.query(
      'SELECT content FROM company_document_chunks WHERE document_id = $1 ORDER BY chunk_index',
      [documentId],
    );
    return rows.rows.map((row: { content: string }) => row.content).join('\n');
  }

  it('nome de funcionário cadastrado e CPF não chegam ao provedor de embedding nem ao chunk persistido', async () => {
    const res = await uploadPgr(
      tenantA,
      'Exame admissional de Marcos Antonio Pereira, CPF 123.456.789-01, aprovado para trabalho em altura.',
    );
    expect(res.status).toBe(201);

    const sent = norm(fakeEmbed.mock.calls.map((call) => call[0] as string).join('\n'));
    const stored = norm(await storedChunkText(res.body.id));

    expect(fakeEmbed).toHaveBeenCalled();
    expect(stored.length).toBeGreaterThan(0);
    for (const text of [sent, stored]) {
      expect(text).not.toContain('Marcos Antonio Pereira');
      expect(text).not.toContain('123.456.789-01');
      expect(text).toContain('[nome removido]');
      expect(text).toContain('[CPF removido]');
      // O conteúdo técnico útil pro Assistente não pode ser destruído junto.
      expect(text).toContain('aprovado para trabalho em altura');
    }
  });

  it('a busca de nomes é do próprio tenant: funcionário de OUTRA empresa não é usado (nem exposto) neste processamento', async () => {
    const res = await uploadPgr(tenantA, 'Visita técnica acompanhada por Beatriz Cristina Lopes no setor de soldagem.');
    expect(res.status).toBe(201);

    const stored = norm(await storedChunkText(res.body.id));
    // "Beatriz" só é funcionária do tenant B; para o tenant A ela é um nome
    // qualquer no texto — mantido. O que este teste garante é que a lista de
    // nomes consultada é a do tenant do upload (RLS), sem cruzar tenants.
    expect(stored).toContain('Beatriz Cristina Lopes');
    expect(stored).toContain('setor de soldagem');
  });
});
