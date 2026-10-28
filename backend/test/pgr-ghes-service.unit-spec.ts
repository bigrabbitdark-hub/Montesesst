import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GhesService } from '../src/atuacao/pgr/ghes.service';
import { PgrPainelService } from '../src/atuacao/pgr/pgr-painel.service';

// Unitário dos serviços de GHE e do resumo do PGR (PGR A, Task 4) com cliente pg falso.
type Q = { sql: string; params: unknown[] };
function fakeClient(handlers: Array<[RegExp, (p: unknown[]) => { rows: any[]; rowCount?: number } | Error]>) {
  const calls: Q[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [re, h] of handlers) {
        if (re.test(sql)) {
          const r = h(params);
          if (r instanceof Error) throw r;
          return r;
        }
      }
      return { rows: [] };
    }),
  };
  return { client, calls };
}
const ator = { id: 'u-socio', role: 'socio' };
const ctx = { role: 'socio', method: 'POST', path: '/atuacao/pgr/empresas/x/ghes', ip: '1.1.1.1' };
const T = '11111111-1111-4111-8111-111111111111';
const G = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const empresaOk: [RegExp, () => { rows: any[] }] = [/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [{ id: T }] })];
const gheOk: [RegExp, () => { rows: any[] }] = [/FROM pgr_ghes WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: G, tenant_id: T }] })];
const audits = (calls: Q[]) => calls.filter((c) => /INSERT INTO audit_log/.test(c.sql));
const writes = (calls: Q[]) => calls.filter((c) => /^\s*(INSERT INTO pgr_|UPDATE pgr_|DELETE FROM pgr_)/.test(c.sql));

describe('GhesService', () => {
  const svc = new GhesService();

  it('empresa invisível ⇒ 404 e nada é gravado', async () => {
    const { client, calls } = fakeClient([[/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [] })]]);
    await expect(svc.criar(client, ator, T, { name: 'TESTE a' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('cargos de outro tenant (contagem diferente) ⇒ 400, sem gravar vínculo nem auditoria', async () => {
    const { client, calls } = fakeClient([empresaOk, gheOk, [/FROM positions WHERE tenant_id/, () => ({ rows: [{ id: P1 }] })]]);
    await expect(svc.definirCargos(client, ator, T, G, { position_ids: [P1, P2] }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(calls)).toHaveLength(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it('unidade que não é da empresa ⇒ 400', async () => {
    const { client, calls } = fakeClient([empresaOk, [/FROM company_units WHERE id/, () => ({ rows: [] })]]);
    await expect(svc.criar(client, ator, T, { name: 'TESTE a', company_unit_id: P1 }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('GHE de outro tenant (não achado com tenant da URL) ⇒ 404', async () => {
    const { client, calls } = fakeClient([empresaOk]);
    await expect(svc.atualizar(client, ator, T, G, { name: 'x' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('PATCH com corpo vazio ⇒ 400; name null ⇒ 400', async () => {
    const { client } = fakeClient([empresaOk, gheOk]);
    await expect(svc.atualizar(client, ator, T, G, {}, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.atualizar(client, ator, T, G, { name: null as any }, ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DELETE com riscos ⇒ 409 e não apaga', async () => {
    const { client, calls } = fakeClient([empresaOk, gheOk, [/count\(\*\)::int AS n FROM pgr_risks/, () => ({ rows: [{ n: 2 }] })]]);
    await expect(svc.excluir(client, ator, T, G, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(calls.some((c) => /DELETE FROM pgr_ghes/.test(c.sql))).toBe(false);
    expect(audits(calls)).toHaveLength(0);
  });

  it('expostos: ativos via cargo e, se o GHE tem unidade, só da unidade (SQL)', async () => {
    const { client, calls } = fakeClient([empresaOk]);
    await svc.listar(client, T);
    const sql = calls.find((c) => /FROM pgr_ghes g/.test(c.sql))!.sql;
    expect(sql).toMatch(/e\.status = 'ativo'/);
    expect(sql).toMatch(/e\.position_id IN \(SELECT position_id FROM pgr_ghe_positions/);
    expect(sql).toMatch(/g\.company_unit_id IS NULL OR e\.company_unit_id = g\.company_unit_id/);
    expect(sql).not.toMatch(/full_name|cpf|birth_date/);
  });

  it('auditoria do vínculo traz só ids/contagem, na mesma conexão', async () => {
    const { client, calls } = fakeClient([empresaOk, gheOk, [/FROM positions WHERE tenant_id/, () => ({ rows: [{ id: P1 }, { id: P2 }] })],
      [/FROM pgr_ghes g/, () => ({ rows: [{ id: G }] })]]);
    await svc.definirCargos(client, ator, T, G, { position_ids: [P1, P2, P1] }, ctx);
    const a = audits(calls);
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('pgr.ghe.positions_set');
    expect(a[0].params[7]).toBe(`ghe: ${G}; empresa: ${T}; cargos: ${P1}, ${P2}`);
    expect(a[0].params).toContain('/atuacao/pgr/empresas/x/ghes');
  });

  it('UPDATE ignora chaves fora da lista permitida (tenant_id, injeção) e só envia colunas conhecidas', async () => {
    const { client, calls } = fakeClient([empresaOk, gheOk, [/FROM pgr_ghes g/, () => ({ rows: [{ id: G }] })]]);
    await svc.atualizar(client, ator, T, G, { name: 'TESTE novo', tenant_id: P1, 'x; drop table pgr_ghes': 1 } as any, ctx);
    const up = calls.find((c) => /^\s*UPDATE pgr_ghes/.test(c.sql))!;
    expect(up.sql).toMatch(/SET name = \$1 WHERE/);
    expect(up.sql.split(' WHERE ')[0]).not.toMatch(/tenant_id|drop/);
    expect(up.params).toEqual(['TESTE novo', G, T]);
    const { client: c2, calls: k2 } = fakeClient([empresaOk, gheOk]);
    await expect(svc.atualizar(c2, ator, T, G, { tenant_id: P1 } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(k2)).toHaveLength(0);
  });

  it('falha na auditoria propaga (fail-closed: o chamador faz ROLLBACK)', async () => {
    const { client } = fakeClient([empresaOk, gheOk, [/count\(\*\)::int AS n FROM pgr_risks/, () => ({ rows: [{ n: 0 }] })],
      [/INSERT INTO audit_log/, () => new Error('falha simulada')]]);
    await expect(svc.excluir(client, ator, T, G, ctx)).rejects.toThrow('falha simulada');
  });
});

describe('PgrPainelService.resumo', () => {
  it('lista pendências do que falta e não inventa grau de risco', async () => {
    const { client } = fakeClient([
      [/FROM tenants t WHERE t.id/, () => ({ rows: [{ id: T, name: 'TESTE E', trade_name: null, cnpj: '12345678000190', cnae_code: null, address_street: null, address_city: null, address_state: null, address_zip: null }] })],
      [/AS unidades/, () => ({ rows: [{ unidades: 0, cargos: 0, funcionarios: 0, ghes: 0, riscos: 0 }] })],
    ]);
    const r = await new PgrPainelService().resumo(client, T);
    expect(r.importados.cnae).toBe(false);
    expect(r.importados.grau_risco).toBeNull();
    expect(r.pendencias).toEqual(expect.arrayContaining(['cnae', 'endereco', 'unidades', 'cargos', 'funcionarios', 'ghes']));
    expect(r.pendencias).not.toContain('grau_risco');
    expect(r.completude).toBeLessThan(40);
  });
});
