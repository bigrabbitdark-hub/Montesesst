import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { PenteFinoExtractorService } from '../src/pente-fino/pente-fino-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from '../src/pente-fino/function-extraction-provider.interface';
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

describe('PenteFinoExtractorService', () => {
  let service: PenteFinoExtractorService;
  const fakeExtract = jest.fn();
  const fakeGetObject = jest.fn();

  beforeEach(async () => {
    fakeExtract.mockClear();
    fakeGetObject.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PenteFinoExtractorService,
        { provide: FUNCTION_EXTRACTION_PROVIDER, useValue: { extract: fakeExtract } },
        { provide: R2Service, useValue: { getObject: fakeGetObject } },
      ],
    }).compile();
    service = moduleRef.get(PenteFinoExtractorService);
  });

  const baseDoc = { id: 'doc-1', tenant_id: 'tenant-1', file_key: 'key-1', mime_type: 'application/pdf' } as any;
  const positions = [{ id: 'pos-1', name: 'Soldador' }];

  describe('extractRows', () => {
    it('extrai, casa com a posição certa, e mantém só item cujo trecho existe de verdade no texto', async () => {
      const pdf = await buildTestPdf('O Soldador está exposto a fumos metálicos durante a solda.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        { function_text: 'Soldador', description: 'Fumos metálicos', source_excerpt: 'exposto a fumos metálicos' },
        { function_text: 'Soldador', description: 'Item inventado', source_excerpt: 'isto não existe no texto' },
      ]);

      const rows = await service.extractRows(baseDoc, 'risco', positions);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ functionTextRaw: 'Soldador', positionId: 'pos-1', description: 'Fumos metálicos' });
    });

    it('function_text sem posição cadastrada correspondente vira positionId null', async () => {
      const pdf = await buildTestPdf('Ajudante Geral exposto a ruído constante.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        { function_text: 'Ajudante Geral', description: 'Ruído', source_excerpt: 'exposto a ruído constante' },
      ]);

      const rows = await service.extractRows(baseDoc, 'risco', positions);

      expect(rows[0].positionId).toBeNull();
    });

    it('não lança exceção e devolve lista vazia quando getObject falha', async () => {
      fakeGetObject.mockRejectedValue(new Error('R2 fora do ar'));

      await expect(service.extractRows(baseDoc, 'risco', positions)).resolves.toEqual([]);
    });

    it('não lança exceção e devolve lista vazia quando o provedor de extração falha', async () => {
      const pdf = await buildTestPdf('Texto qualquer.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockRejectedValue(new Error('API fora do ar'));

      await expect(service.extractRows(baseDoc, 'risco', positions)).resolves.toEqual([]);
    });
  });

  describe('persistRows', () => {
    function fakeClient(): PoolClient {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    }

    it('kind risco insere em pgr_function_risks, apagando extração antiga primeiro', async () => {
      const client = fakeClient();
      await service.persistRows(client, baseDoc, 'risco', [
        { functionTextRaw: 'Soldador', positionId: 'pos-1', description: 'Fumos', sourceExcerpt: 'trecho' },
      ]);

      expect(client.query).toHaveBeenNthCalledWith(1, 'DELETE FROM pgr_function_risks WHERE document_id = $1', ['doc-1']);
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO pgr_function_risks'),
        ['tenant-1', 'doc-1', 'pos-1', 'Soldador', 'Fumos', 'trecho'],
      );
    });

    it('kind exame insere em pcmso_function_exams', async () => {
      const client = fakeClient();
      await service.persistRows(client, baseDoc, 'exame', [
        { functionTextRaw: 'Soldador', positionId: 'pos-1', description: 'Exame respiratório', sourceExcerpt: 'trecho' },
      ]);

      expect(client.query).toHaveBeenNthCalledWith(1, 'DELETE FROM pcmso_function_exams WHERE document_id = $1', ['doc-1']);
      expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO pcmso_function_exams'), [
        'tenant-1',
        'doc-1',
        'pos-1',
        'Soldador',
        'Exame respiratório',
        'trecho',
      ]);
    });

    it('não lança exceção quando o INSERT falha', async () => {
      const client = { query: jest.fn().mockRejectedValue(new Error('constraint violation')) } as unknown as PoolClient;
      await expect(
        service.persistRows(client, baseDoc, 'risco', [
          { functionTextRaw: 'Soldador', positionId: null, description: 'X', sourceExcerpt: 'Y' },
        ]),
      ).resolves.toBeUndefined();
    });
  });
});
