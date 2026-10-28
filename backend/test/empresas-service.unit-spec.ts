import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmpresasService } from '../src/atuacao/empresas/empresas.service';

const EMPRESA = { id: 't1', name: 'ACME', trade_name: null, cnpj: '1', has_authorized: true, has_recent_pending: false, has_lapsed: false };

function mkClient(handler?: (sql: string, params?: any[]) => any) {
  const calls: { sql: string; params?: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      if (handler) { const r = handler(sql, params); if (r) return r; }
      if (/FROM tenants/.test(sql)) return { rows: [EMPRESA] };
      return { rows: [] };
    }),
  };
  return { client, calls };
}

const DOC = {
  id: 'd1', tenant_id: 't1', category: 'pgr', title: 'PGR', file_key: 'segredo/key', file_name: 'a.pdf',
  mime_type: 'application/pdf', size_bytes: 1, valid_from: '2026-01-01', expires_at: '2027-01-01',
  situacao: 'em_dia', uploaded_by_user_id: 'u', uploaded_by_role: 'empresa',
};

describe('EmpresasService', () => {
  const docs: any = { findAll: jest.fn(), findOne: jest.fn(), getDownloadUrl: jest.fn(), updateValidity: jest.fn() };
  const svc = new EmpresasService(docs);
  beforeEach(() => jest.resetAllMocks());

  it('exigirEmpresa lança NotFoundException quando tenants volta vazio', async () => {
    const { client } = mkClient((sql) => (/FROM tenants/.test(sql) ? { rows: [] } : undefined));
    await expect(svc.exigirEmpresa(client, 't1')).rejects.toThrow(NotFoundException);
    await expect(svc.exigirEmpresa(client, 't1')).rejects.toThrow('Empresa não encontrada');
  });

  it('funcionarios não seleciona cpf nem birth_date', async () => {
    const { client, calls } = mkClient();
    await svc.funcionarios(client, 't1');
    const sql = calls.find((c) => /FROM employees/.test(c.sql))!.sql;
    expect(sql).not.toMatch(/cpf|birth_date/);
    expect(sql).toMatch(/LIMIT 500/);
  });

  it('vencimentos usa a data injetada como base de dias_para_vencer', async () => {
    const { client, calls } = mkClient();
    await svc.vencimentos(client, 't1', new Date('2026-10-27T15:00:00Z'));
    const q = calls.find((c) => /FROM documents/.test(c.sql))!;
    expect(q.params).toEqual(['t1', '2026-10-27']);
    expect(q.sql).toMatch(/expires_at IS NOT NULL/);
    expect(q.sql).toMatch(/ORDER BY expires_at/);
  });

  it('visaoGeral monta o resumo com data injetada', async () => {
    const { client, calls } = mkClient((sql) => {
      if (/FROM employees/.test(sql)) return { rows: [{ n: 3 }] };
      if (/FROM documents/.test(sql)) return { rows: [{ total: 2, vencidos: 1, a_vencer_30d: 1 }] };
      if (/FROM tenant_epis/.test(sql)) return { rows: [{ n: 4 }] };
    });
    const r = await svc.visaoGeral(client, 't1', new Date('2026-10-27T15:00:00Z'));
    expect(r).toEqual({
      empresa: { id: 't1', name: 'ACME', trade_name: null, cnpj: '1', situacao: 'ativa' },
      funcionarios_ativos: 3, documentos: { total: 2, vencidos: 1, a_vencer_30d: 1 }, epis_cadastrados: 4,
    });
    expect(calls.find((c) => /FROM documents/.test(c.sql))!.params).toEqual(['t1', '2026-10-27']);
  });

  it('documentos remove file_key e campos internos', async () => {
    const { client } = mkClient();
    docs.findAll.mockResolvedValue([DOC]);
    const r = await svc.documentos(client, 't1');
    expect(docs.findAll).toHaveBeenCalledWith(client, 't1');
    expect(r).toEqual([{ id: 'd1', category: 'pgr', title: 'PGR', file_name: 'a.pdf', valid_from: '2026-01-01', expires_at: '2027-01-01', situacao: 'em_dia' }]);
    expect(JSON.stringify(r)).not.toMatch(/file_key|segredo/);
  });

  it('download/vigencia de documento de outra empresa ⇒ 404 sem chamar getDownloadUrl/updateValidity', async () => {
    const { client } = mkClient();
    docs.findOne.mockResolvedValue({ ...DOC, tenant_id: 'outra' });
    await expect(svc.download(client, 't1', 'd1')).rejects.toThrow(NotFoundException);
    await expect(svc.alterarVigencia(client, 't1', 'd1', 'u', { expires_at: '2027-02-02' })).rejects.toThrow(NotFoundException);
    expect(docs.getDownloadUrl).not.toHaveBeenCalled();
    expect(docs.updateValidity).not.toHaveBeenCalled();
  });

  it('alterarVigencia delega ao DocumentsService e devolve sem file_key', async () => {
    const { client } = mkClient();
    docs.findOne.mockResolvedValue(DOC);
    docs.updateValidity.mockResolvedValue({ ...DOC, expires_at: '2027-02-02' });
    const r: any = await svc.alterarVigencia(client, 't1', 'd1', 'u1', { expires_at: '2027-02-02' });
    expect(docs.updateValidity).toHaveBeenCalledWith(client, 'd1', 'u1', true, { validFrom: undefined, expiresAt: '2027-02-02' });
    expect(r.file_key).toBeUndefined();
    expect(r.expires_at).toBe('2027-02-02');
  });

  it('alterarVigencia com ctx grava auditoria no mesmo client só com os campos que mudaram (old→new)', async () => {
    const { client, calls } = mkClient();
    docs.findOne.mockResolvedValue({ ...DOC, valid_from: null });
    docs.updateValidity.mockResolvedValue({ ...DOC, valid_from: null, expires_at: '2028-01-01' });
    await svc.alterarVigencia(client, 't1', 'd1', 'u1', { valid_from: undefined, expires_at: '2028-01-01' }, { role: 'socio', method: 'PATCH', path: '/p', ip: '1.1.1.1' });
    const aud = calls.find((c) => /INSERT INTO audit_log/.test(c.sql))!;
    expect(aud.params![6]).toBe('documento: d1; expires_at: 2027-01-01→2028-01-01');
    expect(calls.find((c) => /FOR UPDATE/.test(c.sql))).toBeDefined();
  });

  it('alterarVigencia: se a auditoria falha o erro propaga (rollback pelo chamador)', async () => {
    const { client } = mkClient((sql) => { if (/INSERT INTO audit_log/.test(sql)) throw new Error('falha'); });
    docs.findOne.mockResolvedValue(DOC);
    docs.updateValidity.mockResolvedValue({ ...DOC, expires_at: '2028-01-01' });
    await expect(svc.alterarVigencia(client, 't1', 'd1', 'u1', { expires_at: '2028-01-01' }, { role: 'socio', method: 'PATCH', path: '/p' })).rejects.toThrow('falha');
  });

  it('alterarVigencia com corpo vazio ⇒ 400 sem consultar nem atualizar', async () => {
    const { client } = mkClient();
    await expect(svc.alterarVigencia(client, 't1', 'd1', 'u1', {})).rejects.toThrow(BadRequestException);
    await expect(svc.alterarVigencia(client, 't1', 'd1', 'u1', {})).rejects.toThrow('Informe valid_from e/ou expires_at');
    expect(client.query).not.toHaveBeenCalled();
    expect(docs.updateValidity).not.toHaveBeenCalled();
  });
});
