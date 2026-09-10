import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { CompanyDocumentIndexerService } from '../src/documents/company-document-indexer.service';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { DOCX_MIME_TYPE } from '../src/common/docx/docx-text.util';
import { XLSX_MIME_TYPE } from '../src/common/xlsx/xlsx-text.util';

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

describe('CompanyDocumentIndexerService', () => {
  let service: CompanyDocumentIndexerService;
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0));

  beforeEach(async () => {
    fakeEmbed.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [CompanyDocumentIndexerService, { provide: EMBEDDING_PROVIDER, useValue: { embed: fakeEmbed } }],
    }).compile();
    service = moduleRef.get(CompanyDocumentIndexerService);
  });

  describe('shouldIndex', () => {
    it('true pra categoria pgr + PDF', () => {
      expect(service.shouldIndex('pgr', 'application/pdf')).toBe(true);
    });
    it('true pra categoria ltcat + DOCX', () => {
      expect(service.shouldIndex('ltcat', DOCX_MIME_TYPE)).toBe(true);
    });
    it('true pra categoria lip + XLSX', () => {
      expect(service.shouldIndex('lip', XLSX_MIME_TYPE)).toBe(true);
    });
    it('false pra categoria fora das 4 centrais (ex.: treinamento)', () => {
      expect(service.shouldIndex('treinamento', 'application/pdf')).toBe(false);
    });
    it('false pra imagem, mesmo em categoria indexável (sem OCR)', () => {
      expect(service.shouldIndex('pgr', 'image/jpeg')).toBe(false);
    });
  });

  describe('indexDocument', () => {
    function fakeClient(): PoolClient {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    }

    const baseDoc = {
      id: 'doc-1',
      tenant_id: 'tenant-1',
      category: 'pgr',
      mime_type: 'application/pdf',
    } as any;

    it('extrai, quebra em chunks, gera embedding e insere uma linha por chunk', async () => {
      const client = fakeClient();
      const pdf = await buildTestPdf('Risco de ruído na função de soldador. '.repeat(100));

      await service.indexDocument(client, baseDoc, pdf);

      expect(fakeEmbed).toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO company_document_chunks'),
        expect.arrayContaining(['tenant-1', 'doc-1', 'pgr']),
      );
    });

    it('não lança exceção e não insere nada quando a extração não encontra texto (PDF em branco)', async () => {
      const client = fakeClient();
      const blankPdf = await buildTestPdf(null);

      await expect(service.indexDocument(client, baseDoc, blankPdf)).resolves.toBeUndefined();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('não lança exceção nem insere nada quando o buffer não é um PDF válido', async () => {
      const client = fakeClient();

      await expect(
        service.indexDocument(client, baseDoc, Buffer.from('isto não é um pdf')),
      ).resolves.toBeUndefined();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('não lança exceção quando o embedding falha (ex.: API fora do ar)', async () => {
      const client = fakeClient();
      const pdf = await buildTestPdf('Texto real de teste.');
      fakeEmbed.mockRejectedValueOnce(new Error('API fora do ar'));

      await expect(service.indexDocument(client, baseDoc, pdf)).resolves.toBeUndefined();
    });
  });
});
