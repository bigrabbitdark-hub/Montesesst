import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { LipAgentExtractorService } from '../src/pente-fino/lip-agent-extractor.service';
import { LIP_AGENT_EXTRACTION_PROVIDER } from '../src/pente-fino/lip-agent-provider.interface';
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

describe('LipAgentExtractorService', () => {
  let service: LipAgentExtractorService;
  const fakeExtract = jest.fn();
  const fakeGetObject = jest.fn();

  beforeEach(async () => {
    fakeExtract.mockClear();
    fakeGetObject.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LipAgentExtractorService,
        { provide: LIP_AGENT_EXTRACTION_PROVIDER, useValue: { extract: fakeExtract } },
        { provide: R2Service, useValue: { getObject: fakeGetObject } },
      ],
    }).compile();
    service = moduleRef.get(LipAgentExtractorService);
  });

  const baseDoc = { id: 'doc-1', tenant_id: 'tenant-1', file_key: 'key-1', mime_type: 'application/pdf' } as any;

  describe('extractAgents', () => {
    it('extrai um agente ruído com insalubre=true a partir de uma conclusão positiva citada literalmente', async () => {
      const pdf = await buildTestPdf(
        'Ruído contínuo medido em 92 dB(A). Conclusão: caracteriza insalubridade em grau médio.',
      );
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído contínuo',
          agent_category: 'ruido',
          measured_value_raw: '92 dB(A)',
          conclusion_excerpt: 'caracteriza insalubridade em grau médio',
          source_excerpt: 'Ruído contínuo medido em 92 dB(A)',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows).toEqual([
        {
          agentNameRaw: 'Ruído contínuo',
          agentCategory: 'ruido',
          measuredValueRaw: '92 dB(A)',
          insalubre: true,
          conclusionExcerpt: 'caracteriza insalubridade em grau médio',
          sourceExcerpt: 'Ruído contínuo medido em 92 dB(A)',
        },
      ]);
    });

    it('deriva insalubre=false quando a conclusão citada diz "não caracteriza"', async () => {
      const pdf = await buildTestPdf('Ruído medido em 78 dB(A). Não caracteriza insalubridade.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído',
          agent_category: 'ruido',
          measured_value_raw: '78 dB(A)',
          conclusion_excerpt: 'Não caracteriza insalubridade',
          source_excerpt: 'Ruído medido em 78 dB(A)',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].insalubre).toBe(false);
    });

    it('deriva insalubre=null quando a conclusão citada não bate com nenhum dos dois padrões', async () => {
      const pdf = await buildTestPdf('Ruído medido. Avaliação inconclusiva, recomenda-se nova medição.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído',
          agent_category: 'ruido',
          measured_value_raw: '',
          conclusion_excerpt: 'Avaliação inconclusiva, recomenda-se nova medição',
          source_excerpt: 'Ruído medido',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].insalubre).toBeNull();
    });

    it('deriva insalubre=false mesmo com quebra de linha entre "não" e "caracteriza" no excerto (comum em texto extraído de PDF real)', async () => {
      const pdf = await buildTestPdf('Ruído medido em 78 dB(A). Não caracteriza insalubridade.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído',
          agent_category: 'ruido',
          measured_value_raw: '78 dB(A)',
          conclusion_excerpt: 'Não\ncaracteriza insalubridade',
          source_excerpt: 'Ruído medido em 78 dB(A)',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].insalubre).toBe(false);
    });

    it('deriva insalubre=false mesmo com espaço duplo entre "não" e "caracteriza" no excerto', async () => {
      const pdf = await buildTestPdf('Ruído medido em 78 dB(A). Não caracteriza insalubridade.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído',
          agent_category: 'ruido',
          measured_value_raw: '78 dB(A)',
          conclusion_excerpt: 'Não  caracteriza insalubridade',
          source_excerpt: 'Ruído medido em 78 dB(A)',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].insalubre).toBe(false);
    });

    it('deriva insalubre=false para a variante "não se caracteriza a insalubridade"', async () => {
      const pdf = await buildTestPdf('Calor medido. Não se caracteriza a insalubridade.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Calor',
          agent_category: 'calor',
          measured_value_raw: '',
          conclusion_excerpt: 'Não se caracteriza a insalubridade',
          source_excerpt: 'Calor medido',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].insalubre).toBe(false);
    });

    it('descarta o item inteiro quando source_excerpt não existe de verdade no texto (alucinação)', async () => {
      const pdf = await buildTestPdf('Documento sem menção a ruído.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Ruído',
          agent_category: 'ruido',
          measured_value_raw: '90 dB(A)',
          conclusion_excerpt: 'caracteriza insalubridade',
          source_excerpt: 'isto não existe no texto',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows).toEqual([]);
    });

    it('mantém o agente mas zera a conclusão quando conclusion_excerpt não bate no texto (source_excerpt válido)', async () => {
      const pdf = await buildTestPdf('Calor avaliado no setor de fundição.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Calor',
          agent_category: 'calor',
          measured_value_raw: '',
          conclusion_excerpt: 'conclusão inventada que não está no texto',
          source_excerpt: 'Calor avaliado no setor de fundição',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows).toEqual([
        {
          agentNameRaw: 'Calor',
          agentCategory: 'calor',
          measuredValueRaw: null,
          insalubre: null,
          conclusionExcerpt: null,
          sourceExcerpt: 'Calor avaliado no setor de fundição',
        },
      ]);
    });

    it('categoria fora da lista permitida vira "outro"', async () => {
      const pdf = await buildTestPdf('Radiação ionizante avaliada na área de raio-x.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockResolvedValue([
        {
          agent_name_raw: 'Radiação ionizante',
          agent_category: 'radiacao', // fora do enum — a IA nem sempre respeita o schema à risca
          measured_value_raw: '',
          conclusion_excerpt: '',
          source_excerpt: 'Radiação ionizante avaliada na área de raio-x',
        },
      ]);

      const rows = await service.extractAgents(baseDoc);

      expect(rows[0].agentCategory).toBe('outro');
    });

    it('devolve lista vazia quando o documento não tem texto extraível', async () => {
      fakeGetObject.mockResolvedValue(Buffer.from('não é um pdf/docx/xlsx válido'));
      const rows = await service.extractAgents({ ...baseDoc, mime_type: 'image/png' });
      expect(rows).toEqual([]);
      expect(fakeExtract).not.toHaveBeenCalled();
    });

    it('não lança exceção e devolve lista vazia quando getObject falha', async () => {
      fakeGetObject.mockRejectedValue(new Error('R2 fora do ar'));
      await expect(service.extractAgents(baseDoc)).resolves.toEqual([]);
    });

    it('não lança exceção e devolve lista vazia quando o provedor de extração falha', async () => {
      const pdf = await buildTestPdf('Texto qualquer.');
      fakeGetObject.mockResolvedValue(pdf);
      fakeExtract.mockRejectedValue(new Error('API fora do ar'));
      await expect(service.extractAgents(baseDoc)).resolves.toEqual([]);
    });
  });

  describe('persist', () => {
    function fakeClient(): PoolClient {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    }

    it('apaga os registros antigos e insere um por agente', async () => {
      const client = fakeClient();
      const rows = [
        {
          agentNameRaw: 'Ruído',
          agentCategory: 'ruido' as const,
          measuredValueRaw: '90 dB(A)',
          insalubre: true,
          conclusionExcerpt: 'caracteriza insalubridade',
          sourceExcerpt: 'trecho ruído',
        },
        {
          agentNameRaw: 'Calor',
          agentCategory: 'calor' as const,
          measuredValueRaw: null,
          insalubre: null,
          conclusionExcerpt: null,
          sourceExcerpt: 'trecho calor',
        },
      ];

      await service.persist(client, baseDoc, rows);

      expect(client.query).toHaveBeenNthCalledWith(1, 'DELETE FROM lip_agent_findings WHERE document_id = $1', [
        'doc-1',
      ]);
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO lip_agent_findings'),
        ['tenant-1', 'doc-1', 'Ruído', 'ruido', '90 dB(A)', true, 'caracteriza insalubridade', 'trecho ruído'],
      );
      expect(client.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO lip_agent_findings'),
        ['tenant-1', 'doc-1', 'Calor', 'calor', null, null, null, 'trecho calor'],
      );
    });

    it('apaga os registros antigos mesmo com lista vazia (documento sem agente nenhum)', async () => {
      const client = fakeClient();
      await service.persist(client, baseDoc, []);
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(client.query).toHaveBeenNthCalledWith(1, 'DELETE FROM lip_agent_findings WHERE document_id = $1', [
        'doc-1',
      ]);
    });

    it('não lança exceção quando o INSERT falha', async () => {
      const client = { query: jest.fn().mockRejectedValue(new Error('constraint violation')) } as unknown as PoolClient;
      await expect(
        service.persist(client, baseDoc, [
          {
            agentNameRaw: 'Ruído',
            agentCategory: 'ruido' as const,
            measuredValueRaw: null,
            insalubre: null,
            conclusionExcerpt: null,
            sourceExcerpt: 'trecho',
          },
        ]),
      ).resolves.toBeUndefined();
    });
  });
});
