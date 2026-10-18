import { buildSstCoverageMatrix, evaluateSstAuditRules } from '../src/pente-fino/sst-audit-rules';

const auditDate = new Date('2026-09-30T00:00:00.000Z');

describe('sst-audit-rules', () => {
  it('detecta divergência quantitativa e não converte em NC quando a regra não está validada', () => {
    const facts = [
      {
        id: 'fact-lip-1',
        document_id: 'doc-lip',
        document_title: 'LIP 2026',
        fact_type: 'noise_measurement',
        subject_type: 'agent',
        subject_raw: 'Ruído',
        subject_key: 'ruido',
        value_json: { value: 91.62 },
        unit: 'dB(A)',
        page_number: 3,
        source_excerpt: 'Ruído contínuo em 91,62 dB(A).',
      },
      {
        id: 'fact-ltcat-1',
        document_id: 'doc-ltcat',
        document_title: 'LTCAT 2026',
        fact_type: 'noise_measurement',
        subject_type: 'agent',
        subject_raw: 'Ruído',
        subject_key: 'ruido',
        value_json: { value: 67.5 },
        unit: 'dB(A)',
        page_number: 2,
        source_excerpt: 'Ruído contínuo em 67,5 dB(A).',
      },
    ];

    const results = evaluateSstAuditRules(facts, auditDate);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'IN',
          summary: expect.stringMatching(/diverg|diferenc/i),
        }),
      ]),
    );
    expect(results.some((result) => result.outcome === 'NC')).toBe(false);
  });

  it('constrói a matriz de cobertura com status por documento e item', () => {
    const facts = [
      {
        id: 'fact-1',
        document_id: 'doc-lip',
        document_title: 'LIP 2026',
        fact_type: 'noise_measurement',
        subject_type: 'agent',
        subject_raw: 'Ruído',
        subject_key: 'ruido',
        value_json: { value: 91.62 },
        unit: 'dB(A)',
        page_number: 3,
        source_excerpt: 'Ruído contínuo em 91,62 dB(A).',
      },
    ];

    const matrix = buildSstCoverageMatrix(facts, [
      { id: 'doc-lip', title: 'LIP 2026', extracted_at: null },
      { id: 'doc-ltcat', title: 'LTCAT 2026', extracted_at: null },
    ]);

    expect(matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: 'noise_measurement',
          document_results: expect.arrayContaining([
            expect.objectContaining({ document_type: 'doc-lip', status: 'consistent' }),
            expect.objectContaining({ document_type: 'doc-ltcat', status: 'not_reported' }),
          ]),
        }),
      ]),
    );
  });
});
