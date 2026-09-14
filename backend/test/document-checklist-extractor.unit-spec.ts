import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { DocumentChecklistExtractorService } from '../src/pente-fino/document-checklist-extractor.service';
import { DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER } from '../src/pente-fino/document-checklist-provider.interface';
import { R2Service } from '../src/common/r2/r2.service';

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

const EMPTY_EXTRACTION = {
  elaboration_date: '',
  elaboration_date_excerpt: '',
  professional_name: '',
  professional_registro: '',
  professional_papel: '',
  professional_excerpt: '',
};

describe('DocumentChecklistExtractorService', () => {
  let service: DocumentChecklistExtractorService;
  const fakeExtract = jest.fn();
  const fakeGetObject = jest.fn();

  beforeEach(async () => {
    fakeExtract.mockClear();
    fakeGetObject.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentChecklistExtractorService,
        { provide: DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER, useValue: { extract: fakeExtract } },
        { provide: R2Service, useValue: { getObject: fakeGetObject } },
      ],
    }).compile();
    service = moduleRef.get(DocumentChecklistExtractorService);
  });

  const baseDoc = { id: 'doc-1', tenant_id: 'tenant-1', file_key: 'key-1', mime_type: 'application/pdf' } as any;

  describe('extractChecklist', () => {
    it('extrai data e profissional quando os excertos batem literalmente no texto', async () => {
      const pdf = await buildTestPdf(
        'PGR elaborado em 15 de março de 2025. Responsável técnico: João Silva, CREA-12345, Engenheiro de Segurança do Trabalho.',
      );
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue({
        elaboration_date: '2025-03-15',
        elaboration_date_excerpt: 'elaborado em 15 de março de 2025',
        professional_name: 'João Silva',
        professional_registro: 'CREA-12345',
        professional_papel: 'Engenheiro de Segurança do Trabalho',
        professional_excerpt: 'João Silva, CREA-12345, Engenheiro de Segurança do Trabalho',
      });

      const row = await service.extractChecklist(baseDoc);

      expect(row).toEqual({
        elaborationDate: '2025-03-15',
        elaborationDateSourceExcerpt: 'elaborado em 15 de março de 2025',
        professionalName: 'João Silva',
        professionalRegistro: 'CREA-12345',
        professionalPapel: 'Engenheiro de Segurança do Trabalho',
        professionalSourceExcerpt: 'João Silva, CREA-12345, Engenheiro de Segurança do Trabalho',
      });
    });

    it('descarta a data quando o excerto citado não existe de verdade no texto (alucinação)', async () => {
      const pdf = await buildTestPdf('Documento sem nenhuma data escrita.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        elaboration_date: '2025-01-01',
        elaboration_date_excerpt: 'isto não existe no texto',
      });

      const row = await service.extractChecklist(baseDoc);

      expect(row.elaborationDate).toBeNull();
      expect(row.elaborationDateSourceExcerpt).toBeNull();
    });

    it('descarta a data quando o formato devolvido não é AAAA-MM-DD válido', async () => {
      const pdf = await buildTestPdf('Documento elaborado recentemente.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        elaboration_date: 'recentemente',
        elaboration_date_excerpt: 'elaborado recentemente',
      });

      const row = await service.extractChecklist(baseDoc);

      expect(row.elaborationDate).toBeNull();
    });

    it('descarta o profissional quando o excerto não existe no texto', async () => {
      const pdf = await buildTestPdf('Documento sem identificação de responsável técnico.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        professional_name: 'Fulano Inventado',
        professional_excerpt: 'isto não existe no texto',
      });

      const row = await service.extractChecklist(baseDoc);

      expect(row.professionalName).toBeNull();
      expect(row.professionalSourceExcerpt).toBeNull();
    });

    it('devolve tudo null quando a IA não encontra nada (strings vazias)', async () => {
      const pdf = await buildTestPdf('Documento genérico sem data nem profissional identificáveis.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue(EMPTY_EXTRACTION);

      const row = await service.extractChecklist(baseDoc);

      expect(row).toEqual({
        elaborationDate: null,
        elaborationDateSourceExcerpt: null,
        professionalName: null,
        professionalRegistro: null,
        professionalPapel: null,
        professionalSourceExcerpt: null,
      });
    });

    it('não lança exceção e devolve EMPTY_ROW quando getObject falha', async () => {
      fakeGetObject.mockRejectedValue(new Error('R2 fora do ar'));

      await expect(service.extractChecklist(baseDoc)).resolves.toEqual({
        elaborationDate: null,
        elaborationDateSourceExcerpt: null,
        professionalName: null,
        professionalRegistro: null,
        professionalPapel: null,
        professionalSourceExcerpt: null,
      });
    });

    it('não lança exceção e devolve EMPTY_ROW quando o provedor de extração falha', async () => {
      const pdf = await buildTestPdf('Texto qualquer.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockRejectedValue(new Error('API fora do ar'));

      await expect(service.extractChecklist(baseDoc)).resolves.toEqual({
        elaborationDate: null,
        elaborationDateSourceExcerpt: null,
        professionalName: null,
        professionalRegistro: null,
        professionalPapel: null,
        professionalSourceExcerpt: null,
      });
    });
  });

  describe('persist', () => {
    function fakeClient(): PoolClient {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    }

    it('apaga o registro antigo e insere o novo', async () => {
      const client = fakeClient();
      const row = {
        elaborationDate: '2025-03-15',
        elaborationDateSourceExcerpt: 'trecho data',
        professionalName: 'João Silva',
        professionalRegistro: 'CREA-12345',
        professionalPapel: 'Engenheiro',
        professionalSourceExcerpt: 'trecho profissional',
      };

      await service.persist(client, baseDoc, row);

      expect(client.query).toHaveBeenNthCalledWith(
        1,
        'DELETE FROM document_checklist_findings WHERE document_id = $1',
        ['doc-1'],
      );
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO document_checklist_findings'),
        ['tenant-1', 'doc-1', '2025-03-15', 'trecho data', 'João Silva', 'CREA-12345', 'Engenheiro', 'trecho profissional'],
      );
    });

    it('não lança exceção quando o INSERT falha', async () => {
      const client = { query: jest.fn().mockRejectedValue(new Error('constraint violation')) } as unknown as PoolClient;
      const emptyRow = {
        elaborationDate: null,
        elaborationDateSourceExcerpt: null,
        professionalName: null,
        professionalRegistro: null,
        professionalPapel: null,
        professionalSourceExcerpt: null,
      };

      await expect(service.persist(client, baseDoc, emptyRow)).resolves.toBeUndefined();
    });
  });
});
