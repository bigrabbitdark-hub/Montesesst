import { PenteFinoController } from '../src/pente-fino/pente-fino.controller';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';

const comparisonReport = { pgr_document: null, audit_findings: [], warnings: [] };
const sstReport = {
  audit_id: 'audit-2026-10-07', generated_at: '2026-10-07T00:00:00.000Z', audit_status: 'partial',
  company: { id: 'tenant-1', name: 'Empresa Teste' }, documents: [],
  scope_counts: { total: 0, complete: 0, partial: 0, not_evaluable: 0 },
  summary: { conclusion: 'Auditoria parcial de teste.', nc_count: 0, inconsistency_count: 1, missing_evidence_count: 0, risks_to_confirm_count: 0 },
  coverage_matrix: [],
  findings: [{ id: 'rule-1', category: 'IN', status: 'to_confirm', confidence: 'medium', summary: 'Divergência de ruído entre LIP e LTCAT', evidence: [], limitations: [], recommended_verification: 'Conferir medições' }],
  recommendations: ['Conferir medições'], limitations: [], functions: [], lip_agents: [], agent_coverage: [], warnings: [],
};

describe('PenteFinoController.run', () => {
  const user = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  it('sem include_pdf devolve o relatório do comparador e não extrai fatos', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn() };
    const controller = new PenteFinoController(comparison as any, audit as any);

    const result = await controller.run({} as any, { user });

    expect(result).toBe(comparisonReport);
    expect(audit.build).not.toHaveBeenCalled();
  });

  it('com include_pdf gera o PDF a partir do SstAuditReport, não do relatório do comparador', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn(async () => sstReport) };
    const controller = new PenteFinoController(comparison as any, audit as any);

    const result: any = await controller.run({ include_pdf: true } as any, { user });

    expect(audit.build).toHaveBeenCalledWith(
      { userId: 'user-1', tenantId: 'tenant-1', role: 'empresa' }, 'tenant-1', comparisonReport,
    );
    expect(result.audit_report).toBe(comparisonReport);
    expect(result.sst_audit_report).toBe(sstReport);
    const text = await extractPdfTextFull(Buffer.from(result.pdf_base64, 'base64'));
    expect(text).toContain('Divergência de ruído entre LIP e LTCAT');
    expect(text).not.toContain('undefined');
  });

  it('para técnico usa o tenant do corpo como alvo, mas o ctx sai do JWT', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn(async () => sstReport) };
    const controller = new PenteFinoController(comparison as any, audit as any);

    await controller.run({ include_pdf: true, tenant_id: 'tenant-alvo' } as any, {
      user: { id: 'tec-1', tenantId: null, role: 'tecnico' },
    });

    expect(audit.build).toHaveBeenCalledWith(
      { userId: 'tec-1', tenantId: undefined, role: 'tecnico' }, 'tenant-alvo', comparisonReport,
    );
  });
});
