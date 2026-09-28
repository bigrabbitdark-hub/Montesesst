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

  describe('extractAndEmbed', () => {
    const baseDoc = {
      id: 'doc-1',
      tenant_id: 'tenant-1',
      category: 'pgr',
      mime_type: 'application/pdf',
    } as any;

    it('extrai, quebra em chunks e gera um embedding por chunk — sem PoolClient nenhum', async () => {
      const pdf = await buildTestPdf('Risco de ruído na função de soldador. '.repeat(100));

      const embeddedChunks = await service.extractAndEmbed(baseDoc, pdf);

      expect(fakeEmbed).toHaveBeenCalled();
      expect(embeddedChunks.length).toBeGreaterThan(0);
      expect(embeddedChunks[0]).toEqual(
        expect.objectContaining({ chunkIndex: 0, content: expect.any(String), embedding: expect.any(Array) }),
      );
    });

    it('devolve lista vazia e não gera embedding quando a extração não encontra texto (PDF em branco)', async () => {
      const blankPdf = await buildTestPdf(null);

      await expect(service.extractAndEmbed(baseDoc, blankPdf)).resolves.toEqual([]);
      expect(fakeEmbed).not.toHaveBeenCalled();
    });

    it('não lança exceção e devolve lista vazia quando o buffer não é um PDF válido', async () => {
      await expect(
        service.extractAndEmbed(baseDoc, Buffer.from('isto não é um pdf')),
      ).resolves.toEqual([]);
      expect(fakeEmbed).not.toHaveBeenCalled();
    });

    // ITEM 003 (auditoria 2026-09-27): prova que a minimização de PII chega
    // de fato ao provedor externo (o que sai em embed()) e ao conteúdo que o
    // chamador persiste — não só que a função de redação isolada funciona.
    describe('minimização de PII (ITEM 003)', () => {
      const CPF = '123.456.789-01';
      const NOME = 'Maria Aparecida Souza';

      it('XLSX: nem o CPF nem o nome cadastrado chegam a embed() nem ao conteúdo devolvido', async () => {
        const xlsxDoc = { ...baseDoc, mime_type: XLSX_MIME_TYPE };
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('PCMSO');
        sheet.addRow(['Colaborador', 'CPF', 'Exame']);
        sheet.addRow([NOME, CPF, 'Audiometria — apto']);
        const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

        const embeddedChunks = await service.extractAndEmbed(xlsxDoc, xlsxBuffer, [NOME]);

        expect(embeddedChunks.length).toBeGreaterThan(0);
        const sentToProvider = fakeEmbed.mock.calls.map((call) => call[0] as string).join('\n');
        const persisted = embeddedChunks.map((c) => c.content).join('\n');
        for (const text of [sentToProvider, persisted]) {
          expect(text).not.toContain('123.456.789-01');
          expect(text).not.toContain(NOME);
          expect(text).toContain('[CPF removido]');
          expect(text).toContain('[nome removido]');
          // O conteúdo técnico não pode ser destruído junto.
          expect(text).toContain('Audiometria — apto');
        }
      });

      it('PDF: nem o CPF nem o nome cadastrado chegam a embed() nem ao conteúdo devolvido', async () => {
        const pdf = await buildTestPdf(`Exame admissional de ${NOME}, CPF ${CPF}, resultado apto para a função.`);

        const embeddedChunks = await service.extractAndEmbed(baseDoc, pdf, [NOME]);

        expect(embeddedChunks.length).toBeGreaterThan(0);
        const sentToProvider = fakeEmbed.mock.calls.map((call) => call[0] as string).join('\n');
        const persisted = embeddedChunks.map((c) => c.content).join('\n');
        for (const raw of [sentToProvider, persisted]) {
          // A extração de PDF quebra linha no meio da frase; normaliza só pra comparar.
          const text = raw.replace(/\s+/g, ' ');
          expect(text).not.toContain('123.456.789-01');
          expect(text).not.toContain(NOME);
          expect(text).toContain('resultado apto para a função');
        }
      });

      it('sem lista de nomes (chamada antiga, 2 argumentos), o CPF ainda é redigido', async () => {
        const pdf = await buildTestPdf(`Funcionário com CPF ${CPF} afastado.`);

        const embeddedChunks = await service.extractAndEmbed(baseDoc, pdf);

        const sentToProvider = fakeEmbed.mock.calls.map((call) => call[0] as string).join('\n');
        expect(embeddedChunks.length).toBeGreaterThan(0);
        expect(sentToProvider).not.toContain('123.456.789-01');
        expect(sentToProvider).toContain('[CPF removido]');
      });
    });

    it('não lança exceção quando o embedding falha (ex.: API fora do ar)', async () => {
      const pdf = await buildTestPdf('Texto real de teste.');
      fakeEmbed.mockRejectedValueOnce(new Error('API fora do ar'));

      await expect(service.extractAndEmbed(baseDoc, pdf)).resolves.toEqual([]);
    });

    it('usa groupLinesIntoChunks (não splitIntoChunks) pro caminho XLSX — nenhuma linha é cortada ao meio', async () => {
      const xlsxDoc = { ...baseDoc, mime_type: XLSX_MIME_TYPE };
      // Uma linha bem maior que o limite de chunk (2000 caracteres) — se o
      // caminho XLSX ainda usasse splitIntoChunks, essa frase única seria
      // cortada ao meio em algum ponto arbitrário de caractere.
      const bigCellValue = 'X'.repeat(2500);
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Ruído');
      sheet.addRow(['Função', 'Medição']);
      sheet.addRow(['Soldador', bigCellValue]);
      sheet.addRow(['Pintor', '85 dB(A)']);
      const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const embeddedChunks = await service.extractAndEmbed(xlsxDoc, xlsxBuffer);

      expect(embeddedChunks.length).toBeGreaterThan(0);
      // A linha com o valor gigante precisa aparecer INTEIRA em algum
      // chunk — se tivesse sido cortada, nenhum chunk conteria o valor
      // completo de 2500 caracteres.
      const allContent = embeddedChunks.map((c) => c.content).join('\n');
      expect(allContent).toContain(bigCellValue);
      // A linha do Pintor também precisa estar íntegra (nunca partida).
      expect(allContent).toContain('Aba: Ruído | Função: Pintor | Medição: 85 dB(A)');
    });

    it('trunca em MAX_CHUNKS_PER_DOCUMENT (500) quando a extração gera mais pedaços que isso (Finding #3)', async () => {
      const xlsxDoc = { ...baseDoc, mime_type: XLSX_MIME_TYPE };
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Ruído');
      sheet.addRow(['Função', 'Medição']);
      // 510 linhas, cada uma com uma célula > 2000 caracteres — cada linha
      // vira sozinha um chunk (groupLinesIntoChunks nunca as agrupa, ver
      // teste acima), garantindo exatamente 510 chunks antes do teto.
      for (let i = 0; i < 510; i++) {
        sheet.addRow([`Funcao-${i}`, 'M'.repeat(2100)]);
      }
      const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const embeddedChunks = await service.extractAndEmbed(xlsxDoc, xlsxBuffer);

      expect(embeddedChunks.length).toBe(500);
      expect(fakeEmbed).toHaveBeenCalledTimes(500);
      // chunkIndex precisa ser 0..499, sequencial, sem furo.
      expect(embeddedChunks.map((c) => c.chunkIndex)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    });
  });

  describe('persistChunks', () => {
    function fakeClient(): PoolClient {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    }

    const baseDoc = {
      id: 'doc-1',
      tenant_id: 'tenant-1',
      category: 'pgr',
      mime_type: 'application/pdf',
    } as any;

    it('insere uma linha por chunk já embutido, usando o PoolClient recebido', async () => {
      const client = fakeClient();
      const embeddedChunks = [
        { chunkIndex: 0, content: 'Trecho 1', embedding: new Array(1536).fill(0) },
        { chunkIndex: 1, content: 'Trecho 2', embedding: new Array(1536).fill(0) },
      ];

      await service.persistChunks(client, baseDoc, embeddedChunks);

      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO company_document_chunks'),
        expect.arrayContaining(['tenant-1', 'doc-1', 'pgr', 0, 'Trecho 1']),
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO company_document_chunks'),
        expect.arrayContaining(['tenant-1', 'doc-1', 'pgr', 1, 'Trecho 2']),
      );
    });

    it('não faz nada (nenhum INSERT) quando a lista de chunks embutidos está vazia', async () => {
      const client = fakeClient();

      await service.persistChunks(client, baseDoc, []);

      expect(client.query).not.toHaveBeenCalled();
    });

    it('não lança exceção quando o INSERT falha (ex.: dimensão de embedding errada, pool esgotado no meio)', async () => {
      const client = { query: jest.fn().mockRejectedValue(new Error('erro de banco')) } as unknown as PoolClient;
      const embeddedChunks = [{ chunkIndex: 0, content: 'Trecho 1', embedding: new Array(1536).fill(0) }];

      await expect(service.persistChunks(client, baseDoc, embeddedChunks)).resolves.toBeUndefined();
    });
  });
});
