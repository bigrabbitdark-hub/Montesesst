import { buildSstAuditReport, SstAuditReportInput } from '../src/pente-fino/sst-audit-report.service';

describe('buildSstAuditReport', () => {
  it('monta resumo por seção e preserva o estado parcial sem inventar conformidade', () => {
    const input: SstAuditReportInput = {
      audit_date: '2026-09-30',
      company: { id: 'tenant-1', name: 'Empresa Teste' },
      documents: [
        { id: 'pgr', type: 'pgr', title: 'PGR', status: 'complete' },
        { id: 'pcmso', type: 'pcmso', title: 'PCMSO', status: 'partial' },
        { id: 'ltcat', type: 'ltcat', title: 'LTCAT', status: 'complete' },
        { id: 'lip', type: 'lip', title: 'LIP', status: 'partial' },
      ],
      findings: [
        { id: 'f-1', category: 'NC', status: 'confirmed', confidence: 'high', summary: 'Risco sem exame', evidence: [], limitations: [], recommended_verification: 'Conferir PGR/PCMSO', priority: 1 },
        { id: 'f-2', category: 'IN', status: 'to_confirm', confidence: 'medium', summary: 'Divergência de ruído', evidence: [], limitations: [], recommended_verification: 'Conferir medições', priority: 2 },
      ],
      recommendations: ['Conferir PGR', 'Conferir PCMSO'],
      limitations: ['Em uma página do PCMSO houve dado clínico individual e foi marcado como não avaliado.'],
      coverage_matrix: [{ item: 'noise_measurement', document_results: [] }],
    };

    const report = buildSstAuditReport(input);

    expect(report.audit_status).toBe('partial');
    expect(report.summary.nc_count).toBe(1);
    expect(report.summary.inconsistency_count).toBe(1);
    expect(report.summary.conclusion).toMatch(/parcial|faltante|não avaliado/i);
    expect(report.findings).toHaveLength(2);
    expect(report.recommendations).toEqual(['Conferir PGR', 'Conferir PCMSO']);
  });
});
