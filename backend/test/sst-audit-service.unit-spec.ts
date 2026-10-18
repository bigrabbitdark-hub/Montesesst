import { SstAuditService } from '../src/pente-fino/sst-audit.service';

const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

function ref(id: string, title: string) {
  return {
    id, title, extracted_at: null, elaboration_date: null, elaboration_date_source_excerpt: null,
    professional_name: null, professional_registro: null, professional_papel: null, professional_source_excerpt: null,
  };
}

function makeService(documents: any[], getFacts: jest.Mock) {
  const db = {
    withTenantContext: jest.fn(async (_ctx: any, fn: any) => {
      const client = {
        query: jest.fn(async (sql: string) =>
          sql.includes('FROM tenants') ? { rows: [{ name: 'Empresa Teste' }] } : { rows: documents },
        ),
      };
      return fn(client);
    }),
  };
  return new SstAuditService(db as any, { getFacts } as any);
}

describe('SstAuditService.build', () => {
  it('extrai fatos só dos documentos presentes e lista os ausentes como limitação', async () => {
    const getFacts = jest.fn(async (_ctx: any, document: any) => ({
      id: `ext-${document.id}`, tenant_id: 'tenant-1', document_id: document.id, document_sha256: 'x',
      extractor_version: 'v', page_count: 2, status: 'complete', unevaluated_pages: [], facts: [],
    }));
    const service = makeService([{ id: 'doc-pgr', title: 'PGR 2026', category: 'pgr' }], getFacts);

    const report = await service.build(
      ctx, 'tenant-1',
      { pgr_document: ref('doc-pgr', 'PGR 2026'), pcmso_document: null, ltcat_document: null, lip_document: null,
        functions: [], lip_agents: [], agent_coverage: [], audit_findings: [], warnings: [] } as any,
      new Date('2026-10-07T12:00:00Z'),
    );

    expect(getFacts).toHaveBeenCalledTimes(1);
    expect(report.company).toEqual({ id: 'tenant-1', name: 'Empresa Teste' });
    expect(report.documents).toEqual([{ id: 'doc-pgr', type: 'pgr', title: 'PGR 2026', status: 'complete' }]);
    expect(report.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PCMSO.*não localizado/),
        expect.stringMatching(/LTCAT.*não localizado/),
        expect.stringMatching(/LIP.*não localizado/),
      ]),
    );
  });

  it('documento cujo getFacts devolve failed vira not_evaluable e não derruba o relatório', async () => {
    const getFacts = jest.fn(async (_ctx: any, document: any) => ({
      id: null, tenant_id: 'tenant-1', document_id: document.id, document_sha256: null,
      extractor_version: 'v', page_count: 0, status: 'failed', unevaluated_pages: [], facts: [],
    }));
    const service = makeService([{ id: 'doc-pcmso', title: 'PCMSO', category: 'pcmso' }], getFacts);

    const report = await service.build(
      ctx, 'tenant-1',
      { pgr_document: null, pcmso_document: ref('doc-pcmso', 'PCMSO'), ltcat_document: null, lip_document: null,
        functions: [], lip_agents: [], agent_coverage: [], audit_findings: [], warnings: [] } as any,
    );

    expect(report.documents[0].status).toBe('not_evaluable');
    expect(report.summary.nc_count).toBe(0);
  });
});
