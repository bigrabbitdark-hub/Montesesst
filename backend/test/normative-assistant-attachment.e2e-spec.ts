import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph } from 'docx';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { RedisService } from '../src/common/redis/redis.service';
import { TestDb } from './db-test-helper';

import { tinyPngVariant } from './file-fixtures';
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

describe('POST /assistant/normative-query — anexo de documento/imagem (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  const fakeAnswer = jest.fn();
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Anexo Assistente Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('PDF com texto real: extrai e passa como attachment pdf_text pro provedor de resposta', async () => {
    const pdf = await buildTestPdf('Conteúdo real de teste no PDF anexado.');
    fakeAnswer.mockResolvedValue([
      {
        claim: 'O documento anexado confirma X.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'o que este documento diz?')
      .attach('file', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('O documento anexado confirma X.');
    expect(res.body.used_attachment).toBe(true);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const attachmentArg = lastCall[5];
    expect(attachmentArg.kind).toBe('pdf_text');
    expect(attachmentArg.content).toContain('Conteúdo real de teste no PDF anexado.');
  });

  it('PDF sem texto extraível: devolve attachment_warning, sem quebrar a pergunta, e não chama o provedor sem outra fonte', async () => {
    const blankPdf = await buildTestPdf(null);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'o que este documento diz?')
      .attach('file', blankPdf, { filename: 'vazio.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.attachment_warning).toContain('Não consegui ler texto deste PDF');
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('imagem: passa como attachment image (base64) pro provedor de resposta', async () => {
    const fakeImage = tinyPngVariant('for-test');
    fakeAnswer.mockResolvedValue([
      {
        claim: 'A imagem mostra um capacete.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'o que aparece nesta foto?')
      .attach('file', fakeImage, { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.used_attachment).toBe(true);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const attachmentArg = lastCall[5];
    expect(attachmentArg.kind).toBe('image');
    expect(attachmentArg.mimeType).toBe('image/png');
    expect(attachmentArg.content).toBe(fakeImage.toString('base64'));
  });

  it('rejeita mimetype não permitido com 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'pergunta qualquer')
      .attach('file', Buffer.from('conteudo'), {
        filename: 'malicioso.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
  });

  it('sem anexo continua funcionando exatamente como antes (compatibilidade multipart/JSON)', async () => {
    fakeAnswer.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'pergunta sem anexo nenhum' });

    expect(res.status).toBe(201);
    expect(res.body.used_attachment).toBeUndefined();
    expect(res.body.attachment_warning).toBeUndefined();
  });

  it('sem anexo nenhum: uses_attachment alucinado (true) não passa pelo Verificador sem fonte real', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Afirmação fabricada sem fonte real.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'pergunta sem anexo nenhum' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
  });

  it('pergunta com anexo usa uma chave de rate limit dedicada, separada da rota geral', async () => {
    const redis = app.get(RedisService);
    const fakeImage = tinyPngVariant('key-test');
    fakeAnswer.mockResolvedValue([]);

    // Limpa qualquer chave já existente com este prefixo antes — evita
    // herdar contagem de uma rodada anterior desta mesma suíte ou de
    // outra execução no mesmo Redis compartilhado (mesmo cuidado já
    // registrado sobre contadores de rate limit persistindo entre
    // execuções neste projeto).
    const existingKeys = await redis.client.keys('ratelimit:AssistantAttachment:*');
    for (const k of existingKeys) {
      await redis.client.del(k);
    }

    await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'pergunta com anexo')
      .attach('file', fakeImage, { filename: 'foto.png', contentType: 'image/png' });

    const keysAfter = await redis.client.keys('ratelimit:AssistantAttachment:*');
    expect(keysAfter.length).toBe(1);
    const count = await redis.client.get(keysAfter[0]);
    expect(Number(count)).toBe(1);

    // Limpeza — não deixa a chave de teste pendurada influenciando
    // execuções futuras desta mesma suíte no mesmo Redis compartilhado.
    await redis.client.del(keysAfter[0]);
  });

  it('DOCX com texto real: extrai e passa como attachment docx_text pro provedor de resposta', async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph('Conteúdo real de teste no DOCX anexado.')] }],
    });
    const buffer = await Packer.toBuffer(doc);

    fakeAnswer.mockResolvedValue([
      {
        claim: 'O documento anexado confirma X.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'o que este documento diz?')
      .attach('file', buffer, {
        filename: 'doc.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    expect(res.status).toBe(201);
    expect(res.body.used_attachment).toBe(true);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const attachmentArg = lastCall[5];
    expect(attachmentArg.kind).toBe('docx_text');
    expect(attachmentArg.content).toContain('Conteúdo real de teste no DOCX anexado.');
  });

  it('XLSX: extrai linhas e passa como attachment xlsx_text pro provedor de resposta', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ruído');
    sheet.addRow(['Função', 'Medição']);
    sheet.addRow(['Soldador', '92 dB(A)']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    fakeAnswer.mockResolvedValue([
      {
        claim: 'A planilha mostra 92 dB(A) para soldador.',
        chunk_ids: [],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${token}`)
      .field('question', 'o que esta planilha mostra?')
      .attach('file', buffer, {
        filename: 'medicoes.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.used_attachment).toBe(true);

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const attachmentArg = lastCall[5];
    expect(attachmentArg.kind).toBe('xlsx_text');
    expect(attachmentArg.content).toContain('Soldador');
  });
});
