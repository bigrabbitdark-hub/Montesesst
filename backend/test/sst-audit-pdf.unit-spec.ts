import PDFDocument from 'pdfkit';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';
import { buildSstAuditPdf } from '../src/pente-fino/sst-audit-pdf.service';

function buildPdfBytes(): Buffer {
  return new PDFDocument({ size: 'A4' }).pipe(new (require('stream').Writable)({
    write(chunk, _encoding, callback) {
      this._buf = Buffer.concat([this._buf ?? Buffer.alloc(0), Buffer.from(chunk)]);
      callback();
    },
    final(callback) {
      this.emit('result', this._buf);
      callback();
    },
  }));
}

describe('buildSstAuditPdf', () => {
  it('gera PDF multi-página e preserva texto da auditoria', async () => {
    const report = {
      audit_id: 'audit-2026-09-30',
      generated_at: '2026-09-30T00:00:00.000Z',
      audit_status: 'partial',
      company: { id: 'tenant-1', name: 'Empresa Teste' },
      documents: [
        { id: 'pgr', type: 'pgr', title: 'PGR', status: 'complete' },
        { id: 'pcmso', type: 'pcmso', title: 'PCMSO', status: 'partial' },
      ],
      scope_counts: { total: 2, complete: 1, partial: 1, not_evaluable: 0 },
      summary: {
        conclusion: 'Audição parcial com páginas não avaliadas.',
        nc_count: 1,
        inconsistency_count: 1,
        missing_evidence_count: 1,
        risks_to_confirm_count: 1,
      },
      coverage_matrix: [
        { item: 'noise_measurement', document_results: [] },
      ],
      findings: [
        { id: 'f-1', category: 'NC', status: 'confirmed', confidence: 'high', summary: 'Risco sem exame', evidence: [], limitations: [], recommended_verification: 'Conferir documento', priority: 1 },
      ],
      recommendations: ['Conferir risco e exame'],
      limitations: ['Página do PCMSO marcou dado clínico individual.'],
      functions: [],
      lip_agents: [],
      agent_coverage: [],
      warnings: ['Página do PCMSO não foi avaliada.'],
    } as const;

    const pdf = await buildSstAuditPdf(report as any);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractPdfTextFull(pdf);
    expect(text).toMatch(/Audição|Empresa Teste|Risco sem exame|Conferir risco e exame/i);
  });
});
