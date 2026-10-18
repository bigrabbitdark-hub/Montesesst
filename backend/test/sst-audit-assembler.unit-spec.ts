import { assembleSstAuditInput, SstAuditAssemblerDocument } from '../src/pente-fino/sst-audit-assembler';
import { SstAuditFactsResult } from '../src/pente-fino/sst-audit-facts.service';

function extraction(
  documentId: string,
  status: 'complete' | 'partial' | 'failed',
  facts: SstAuditFactsResult['facts'] = [],
  unevaluated: number[] = [],
): SstAuditFactsResult {
  return {
    id: `ext-${documentId}`,
    tenant_id: 'tenant-1',
    document_id: documentId,
    document_sha256: 'abc',
    extractor_version: 'sst-audit-facts-v1',
    page_count: 10,
    status,
    unevaluated_pages: unevaluated,
    facts,
  };
}

function noiseFact(id: string, documentId: string, value: number, page: number) {
  return {
    id,
    tenant_id: 'tenant-1',
    extraction_id: `ext-${documentId}`,
    document_id: documentId,
    fact_type: 'noise_measurement',
    subject_type: 'agent',
    subject_raw: 'Ruído',
    subject_key: 'ruido',
    value_json: { value },
    unit: 'dB(A)',
    evidence_kind: 'direct_measurement' as const,
    confidence: 'high' as const,
    page_number: page,
    source_excerpt: `Ruído em ${value} dB(A).`,
  };
}

const auditDate = new Date('2026-10-07T00:00:00.000Z');
const company = { id: 'tenant-1', name: 'Empresa Teste' };

describe('assembleSstAuditInput', () => {
  it('converte divergência de ruído em achado IN com evidência e página', () => {
    const documents: SstAuditAssemblerDocument[] = [
      { type: 'lip', id: 'doc-lip', title: 'LIP 2026', extraction: extraction('doc-lip', 'complete', [noiseFact('f1', 'doc-lip', 91.6, 3)]) },
      { type: 'ltcat', id: 'doc-ltcat', title: 'LTCAT 2026', extraction: extraction('doc-ltcat', 'complete', [noiseFact('f2', 'doc-ltcat', 85.0, 7)]) },
    ];

    const input = assembleSstAuditInput({ auditDate, company, documents, missingTypes: [] });

    expect(input.findings).toHaveLength(1);
    expect(input.findings[0]).toMatchObject({ category: 'IN', status: 'to_confirm', confidence: 'medium', priority: 2 });
    expect(input.findings[0].evidence.map((e) => e.page)).toEqual([3, 7]);
    expect(input.documents.map((d) => d.status)).toEqual(['complete', 'complete']);
    expect(input.recommendations.length).toBeGreaterThan(0);
  });

  it('marca documento parcial e documento falho, e lista os ausentes como limitação', () => {
    const documents: SstAuditAssemblerDocument[] = [
      { type: 'pcmso', id: 'doc-pcmso', title: 'PCMSO', extraction: extraction('doc-pcmso', 'partial', [], [4, 5]) },
      { type: 'pgr', id: 'doc-pgr', title: 'PGR', extraction: extraction('doc-pgr', 'failed') },
    ];

    const input = assembleSstAuditInput({ auditDate, company, documents, missingTypes: ['lip'] });

    expect(input.documents.find((d) => d.id === 'doc-pcmso')?.status).toBe('partial');
    expect(input.documents.find((d) => d.id === 'doc-pgr')?.status).toBe('not_evaluable');
    expect(input.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PCMSO.*4, 5/),
        expect.stringMatching(/PGR.*não foi possível/i),
        expect.stringMatching(/LIP.*não localizado/i),
      ]),
    );
    expect(input.findings).toHaveLength(0);
  });

  it('sem documentos nem fatos não inventa achado nem conformidade', () => {
    const input = assembleSstAuditInput({ auditDate, company, documents: [], missingTypes: ['pgr', 'pcmso', 'ltcat', 'lip'] });
    expect(input.findings).toEqual([]);
    expect(input.limitations).toHaveLength(4 + 1);
  });
});
