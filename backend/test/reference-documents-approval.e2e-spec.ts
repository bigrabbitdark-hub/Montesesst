import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// A coluna reference_document_chunks.embedding é vector(1536) — o Postgres
// rejeita qualquer array de dimensão diferente, mesmo padrão de
// normative-documents-approval.e2e-spec.ts.
function fakeEmbeddingVector(): number[] {
  return new Array(1536).fill(0.001);
}

// PDF mínimo válido (cabeçalho %PDF- + estrutura suficiente pra pdf-parse
// extrair pelo menos um caractere de texto) — mesmo tipo de fixture usado
// em outros specs de upload deste projeto.
// xref com offsets aproximados — pdf-parse (pdf.js por baixo) tolera xref
// incorreto caindo pra varredura linear por "N 0 obj", então isso deve
// bastar; se o Step 2 abaixo devolver 400 "não foi possível extrair
// texto" em vez de 201, regenere este fixture (ex.: script de uma linha
// com a lib `pdfkit`, já não é dependência do projeto — instale como
// devDependency só pra gerar o arquivo uma vez, ou ajuste os offsets do
// xref à mão) em vez de tentar depurar os bytes abaixo.
const MINIMAL_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDU4Pj5zdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDEwMCBUZCAoVGVzdGUgUmVmZXJlbmNpYSBTU1QpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQ1IDAwMDAwIG4gCjAwMDAwMDAzMTUgMDAwMDAgbiAKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjQyNQolJUVPRg==';

describe('Fluxo de aprovação/indexação de reference_documents (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let documentId: string;
  let fakeEmbed: jest.Mock;

  beforeAll(async () => {
    fakeEmbed = jest.fn().mockResolvedValue(fakeEmbeddingVector());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      // Este spec é sobre o ciclo de aprovação/indexação, não sobre storage:
      // o R2 é substituído por um fake — sem isso o teste chamaria o R2 de
      // verdade (credencial ausente neste ambiente), mesmo padrão de
      // documents-pii-minimization.e2e-spec.ts.
      .overrideProvider(R2Service)
      .useValue({
        putObject: jest.fn().mockResolvedValue(undefined),
        getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://fake-r2-presigned-url.example.com/cartilha-teste.pdf'),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Referencia Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterEach(() => {
    fakeEmbed.mockClear();
    fakeEmbed.mockResolvedValue(fakeEmbeddingVector());
  });

  afterAll(async () => {
    const client = (db as any).client;
    if (documentId) {
      await client.query('DELETE FROM reference_document_chunks WHERE document_id = $1', [documentId]);
      await client.query('DELETE FROM reference_documents WHERE id = $1', [documentId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('upload cria linha aguardando_validacao', async () => {
    const res = await request(app.getHttpServer())
      .post('/reference-documents')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('title', 'Cartilha Teste Referência')
      .field('category', 'Geral')
      .field('origin_note', 'Cartilha de teste — suíte e2e')
      .attach('file', Buffer.from(MINIMAL_PDF_BASE64, 'base64'), { filename: 'cartilha-teste.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('aguardando_validacao');
    expect(res.body.origin_note).toBe('Cartilha de teste — suíte e2e');
    documentId = res.body.id;
  });

  it('upload do mesmo arquivo de novo é rejeitado por duplicata (content_hash)', async () => {
    const res = await request(app.getHttpServer())
      .post('/reference-documents')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('title', 'Cartilha Teste Referência (de novo)')
      .field('category', 'Geral')
      .field('origin_note', 'Cartilha de teste — suíte e2e')
      .attach('file', Buffer.from(MINIMAL_PDF_BASE64, 'base64'), { filename: 'cartilha-teste.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(409);
  });

  it('upload sem origin_note é rejeitado (campo obrigatório)', async () => {
    const res = await request(app.getHttpServer())
      .post('/reference-documents')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('title', 'Cartilha Sem Origem')
      .field('category', 'Geral')
      .attach('file', Buffer.from(MINIMAL_PDF_BASE64, 'base64'), { filename: 'outra.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('reject de um id inexistente devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/reference-documents/00000000-0000-0000-0000-000000000000/reject')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ reason: 'motivo de teste' });

    expect(res.status).toBe(404);
  });

  it('approve indexa os chunks e o documento vira vigente', async () => {
    const res = await request(app.getHttpServer())
      .post(`/reference-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).not.toBeNull();
    expect(fakeEmbed).toHaveBeenCalled();

    const client = (db as any).client;
    const chunks = await client.query('SELECT count(*)::int AS n FROM reference_document_chunks WHERE document_id = $1', [documentId]);
    expect(chunks.rows[0].n).toBeGreaterThan(0);
  });

  it('approve de um documento já vigente é rejeitado (só aguardando_validacao pode ser aprovado)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/reference-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(400);
  });

  it('download de um documento vigente devolve URL assinada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/reference-documents/${documentId}/download`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://fake-r2-presigned-url.example.com/cartilha-teste.pdf');
    expect(res.body.file_name).toBe('cartilha-teste.pdf');
  });

  it('reindex reprocessa os chunks de um documento vigente', async () => {
    fakeEmbed.mockClear();
    const res = await request(app.getHttpServer())
      .post(`/reference-documents/${documentId}/reindex`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(fakeEmbed).toHaveBeenCalled();
  });
});
