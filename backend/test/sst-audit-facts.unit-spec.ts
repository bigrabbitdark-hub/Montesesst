import PDFDocument from 'pdfkit';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../src/common/database/database.service';
import { R2Service } from '../src/common/r2/r2.service';
import { Document } from '../src/documents/documents.service';
import { SstAuditFactsService } from '../src/pente-fino/sst-audit-facts.service';
import { SST_AUDIT_FACTS_PROVIDER } from '../src/pente-fino/sst-audit-facts-provider.interface';

function buildPdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument();
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pages.forEach((text, index) => {
      if (index > 0) pdf.addPage();
      pdf.text(text);
    });
    pdf.end();
  });
}

const document: Document = {
  id: 'document-1',
  tenant_id: 'tenant-1',
  category: 'pgr',
  title: 'PGR da empresa',
  file_key: 'tenant-1/pgr.pdf',
  file_name: 'pgr.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  expires_at: null,
  uploaded_by_user_id: 'user-1',
  uploaded_by_role: 'empresa',
  company_unit_id: null,
  created_at: '2026-09-30T12:00:00.000Z',
  updated_at: '2026-09-30T12:00:00.000Z',
};

const tenantContext = { userId: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

function buildService(options: {
  pdf: Buffer;
  extract: jest.Mock;
  employeeNames?: string[];
}) {
  const cache = {
    extraction: null as Record<string, unknown> | null,
    facts: [] as Record<string, unknown>[],
  };
  const fakeClient = {
    query: jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT full_name FROM employees')) {
        return { rows: (options.employeeNames ?? []).map((full_name) => ({ full_name })) };
      }
      if (sql.includes('FROM sst_audit_document_extractions')) {
        return { rows: cache.extraction ? [cache.extraction] : [] };
      }
      if (sql.includes('FROM sst_audit_facts')) return { rows: cache.facts };
      if (sql.includes('INSERT INTO sst_audit_document_extractions')) {
        cache.extraction = {
          id: 'extraction-1',
          tenant_id: values[0],
          document_id: values[1],
          document_sha256: values[2],
          extractor_version: values[3],
          page_count: values[4],
          status: values[5],
          unevaluated_pages: values[6],
        };
        return { rows: [cache.extraction] };
      }
      if (sql.includes('INSERT INTO sst_audit_facts')) {
        const fact = {
          id: `fact-${cache.facts.length + 1}`,
          tenant_id: values[0],
          extraction_id: values[1],
          document_id: values[2],
          fact_type: values[3],
          subject_type: values[4],
          subject_raw: values[5],
          subject_key: values[6],
          value_json: values[7],
          unit: values[8],
          evidence_kind: values[9],
          confidence: values[10],
          page_number: values[11],
          source_excerpt: values[12],
        };
        cache.facts.push(fact);
        return { rows: [fact] };
      }
      throw new Error(`query inesperada: ${sql}`);
    }),
  };
  const fakeDatabase = {
    withTenantContext: jest.fn((_context: unknown, callback: (client: typeof fakeClient) => unknown) =>
      callback(fakeClient),
    ),
  };
  const fakeR2 = { getObject: jest.fn().mockResolvedValue(options.pdf) };

  return Test.createTestingModule({
    providers: [
      SstAuditFactsService,
      { provide: DatabaseService, useValue: fakeDatabase },
      { provide: R2Service, useValue: fakeR2 },
      { provide: SST_AUDIT_FACTS_PROVIDER, useValue: { extract: options.extract } },
    ],
  })
    .compile()
    .then((moduleRef) => ({
      service: moduleRef.get(SstAuditFactsService),
      fakeDatabase,
      fakeR2,
      cache,
      moduleRef,
    }));
}

describe('SstAuditFactsService', () => {
  it('mascara PII, valida citação na página indicada e descarta citação de outra página', async () => {
    const pdf = await buildPdf([
      'Funcionária Ana Souza CPF 123.456.789-09. Setor Montagem: ruído medido em 91,62 dB(A).',
      'Setor Almoxarifado: ruído medido em 75 dB(A).',
    ]);
    const extract = jest.fn().mockResolvedValue({
      facts: [
        {
          factType: 'noise_measurement',
          subjectType: 'sector',
          subjectRaw: 'Montagem',
          subjectKey: 'montagem',
          value: { value: 91.62 },
          unit: 'dB(A)',
          pageNumber: 1,
          sourceExcerptMasked: 'Setor Montagem: ruído medido em 91,62 dB(A).',
          evidenceKind: 'direct_measurement',
        },
        {
          factType: 'noise_measurement',
          subjectType: 'sector',
          subjectRaw: 'Almoxarifado',
          subjectKey: 'almoxarifado',
          value: { value: 75 },
          unit: 'dB(A)',
          pageNumber: 1,
          sourceExcerptMasked: 'Setor Almoxarifado: ruído medido em 75 dB(A).',
          evidenceKind: 'direct_measurement',
        },
      ],
    });
    const { service, fakeR2, cache, moduleRef } = await buildService({
      pdf,
      employeeNames: ['Ana Souza'],
      extract,
    });

    const result = await service.getFacts(tenantContext, document);

    expect(extract).toHaveBeenCalledTimes(1);
    const providerInput = extract.mock.calls[0][0];
    expect(providerInput.pages[0].text).not.toContain('Ana Souza');
    expect(providerInput.pages[0].text).not.toContain('123.456.789-09');
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toEqual(
      expect.objectContaining({
        document_id: 'document-1',
        page_number: 1,
        source_excerpt: 'Setor Montagem: ruído medido em 91,62 dB(A).',
      }),
    );
    expect(result.status).toBe('partial');
    expect(cache.facts).toHaveLength(1);

    await service.getFacts(tenantContext, document);
    expect(fakeR2.getObject).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });

  it('não envia página de PCMSO com resultado clínico individual e marca-a não avaliada', async () => {
    const pcmso = { ...document, id: 'document-pcmso', category: 'pcmso' };
    const pdf = await buildPdf([
      'Resultado do exame clínico: normal. Funcionária Ana Souza.',
      'Função Montador: exame clínico periódico anual.',
    ]);
    const extract = jest.fn().mockResolvedValue({ facts: [] });
    const { service, cache, moduleRef } = await buildService({
      pdf,
      employeeNames: ['Ana Souza'],
      extract,
    });

    const result = await service.getFacts(tenantContext, pcmso);

    expect(extract).toHaveBeenCalledTimes(1);
    const providerInput = extract.mock.calls[0][0];
    expect(providerInput.pages.map((page: { pageNumber: number }) => page.pageNumber)).toEqual([2]);
    expect(result.status).toBe('partial');
    expect(result.unevaluated_pages).toEqual([1]);
    expect(cache.facts).toEqual([]);
    await moduleRef.close();
  });

  it('cacheia uma extração completa sem fatos e não chama o provider na segunda leitura', async () => {
    const pdf = await buildPdf(['Documento sem fatos SST estruturados.']);
    const extract = jest.fn().mockResolvedValue({ facts: [] });
    const { service, fakeR2, cache, moduleRef } = await buildService({ pdf, extract });

    const first = await service.getFacts(tenantContext, document);
    const second = await service.getFacts(tenantContext, document);

    expect(first.status).toBe('complete');
    expect(second.status).toBe('complete');
    expect(second.facts).toEqual([]);
    expect(cache.extraction?.extractor_version).toBeTruthy();
    expect(fakeR2.getObject).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });

  it('mantém fatos dos grupos válidos quando outro grupo de páginas falha', async () => {
    const pages = Array.from({ length: 9 }, (_, index) => `Página ${index + 1}: texto de SST.`);
    pages[8] = 'Página 9: Setor Montagem com ruído medido em 91,62 dB(A).';
    const pdf = await buildPdf(pages);
    const extract = jest.fn().mockImplementation(({ groupIndex }: { groupIndex: number }) => {
      if (groupIndex === 0) return Promise.reject(new Error('timeout no primeiro grupo'));
      return Promise.resolve({
        facts: [
          {
            factType: 'noise_measurement',
            subjectType: 'sector',
            subjectRaw: 'Montagem',
            subjectKey: 'montagem',
            value: { value: 91.62 },
            unit: 'dB(A)',
            pageNumber: 9,
            sourceExcerptMasked: 'Página 9: Setor Montagem com ruído medido em 91,62 dB(A).',
            evidenceKind: 'direct_measurement',
          },
        ],
      });
    });
    const { service, cache, moduleRef } = await buildService({ pdf, extract });

    const result = await service.getFacts(tenantContext, document);

    expect(result.status).toBe('partial');
    expect(result.unevaluated_pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.facts.map((fact: { page_number: number }) => fact.page_number)).toEqual([9]);
    expect(cache.facts).toHaveLength(1);
    await moduleRef.close();
  });
});