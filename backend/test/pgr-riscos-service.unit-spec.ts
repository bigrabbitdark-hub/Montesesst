import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RiscosService } from '../src/atuacao/pgr/riscos.service';
import { AtualizarRiscoDto, CriarControleDto, CriarMedicaoDto } from '../src/atuacao/pgr/dto/risco.dto';

// Unitário do serviço de riscos/controles/medições (PGR A, Task 5) com cliente pg falso.
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
const ctx = { role: 'socio', method: 'POST', path: '/atuacao/pgr/empresas/x/riscos', ip: '1.1.1.1' };
const T = '11111111-1111-4111-8111-111111111111';
const G = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const H1 = '44444444-4444-4444-8444-444444444444';
const H2 = '55555555-5555-4555-8555-555555555555';
const empresaOk: [RegExp, () => { rows: any[] }] = [/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [{ id: T }] })];
const audits = (calls: Q[]) => calls.filter((c) => /INSERT INTO audit_log/.test(c.sql));
const writes = (calls: Q[]) => calls.filter((c) => /^\s*(INSERT INTO pgr_|UPDATE pgr_|DELETE FROM pgr_)/.test(c.sql));
const erros = (cls: any, obj: object) => validateSync(plainToInstance(cls, obj), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('RiscosService', () => {
  const svc = new RiscosService();

  it('empresa invisível ⇒ 404 e nada é gravado', async () => {
    const { client, calls } = fakeClient([[/FROM tenants t WHERE t\.id = \$1 AND is_montese_tenant/, () => ({ rows: [] })]]);
    await expect(svc.criarDePerigos(client, ator, T, G, { hazard_ids: [H1] }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('GHE de outro tenant ⇒ 404; perigo inativo/invisível (contagem menor) ⇒ 400 sem gravar nem auditar', async () => {
    const a = fakeClient([empresaOk]);
    await expect(svc.criarDePerigos(a.client, ator, T, G, { hazard_ids: [H1] }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    const b = fakeClient([empresaOk, [/FROM pgr_ghes WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: G }] })],
      [/FROM pgr_hazards/, () => ({ rows: [{ id: H1 }] })]]);
    await expect(svc.criarDePerigos(b.client, ator, T, G, { hazard_ids: [H1, H2] }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(b.calls)).toHaveLength(0);
    expect(audits(b.calls)).toHaveLength(0);
  });

  it('PATCH com corpo vazio ⇒ 400 antes de travar linha', async () => {
    const { client, calls } = fakeClient([empresaOk]);
    await expect(svc.atualizar(client, ator, T, R, {} as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => /FOR UPDATE/.test(c.sql))).toBe(false);
  });

  it('PATCH: nulo em campo obrigatório ⇒ 400; só chaves estranhas ⇒ 400 sem travar nem gravar', async () => {
    const { client } = fakeClient([empresaOk]);
    await expect(svc.atualizar(client, ator, T, R, { name: null } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.atualizar(client, ator, T, R, { status: null } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    const w = fakeClient([empresaOk, [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, assessment_type: 'qualitativa' }] })]]);
    await expect(svc.atualizar(w.client, ator, T, R, { tenant_id: 'x', ghe_id: 'y', hazard_id: 'z' } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(w.calls)).toHaveLength(0);
    expect(w.calls.some((c) => /FOR UPDATE/.test(c.sql))).toBe(false);
  });

  it('PATCH: chaves estranhas misturadas a campos válidos nunca chegam ao SQL do UPDATE', async () => {
    const { client, calls } = fakeClient([empresaOk, [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, ghe_id: G, assessment_type: null, exposure_type: null, status: 'rascunho' }] })],
      [/SELECT r\.\*/, () => ({ rows: [{ id: R }] })]]);
    await svc.atualizar(client, ator, T, R, { activity: 'TESTE', tenant_id: 'x', ghe_id: 'y', hazard_id: 'z' } as any, ctx);
    const up = calls.find((c) => /^\s*UPDATE pgr_risks/.test(c.sql))!;
    expect(up.sql).toMatch(/SET activity = \$1 WHERE/);
    expect(up.sql).not.toMatch(/ghe_id =|hazard_id =|tenant_id =\s*\$1/);
    expect(up.params).toEqual(['TESTE', R, T]);
  });

  it('status completo sem exposição ou avaliação ⇒ 400; com ambos passa', async () => {
    const linha = (o: object) => [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, ghe_id: G, status: 'rascunho', ...o }] })] as [RegExp, () => { rows: any[] }];
    const a = fakeClient([empresaOk, linha({ exposure_type: null, assessment_type: 'qualitativa' })]);
    await expect(svc.atualizar(a.client, ator, T, R, { status: 'completo' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    const b = fakeClient([empresaOk, linha({ exposure_type: 'eventual', assessment_type: null })]);
    await expect(svc.atualizar(b.client, ator, T, R, { status: 'completo' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(a.calls).concat(writes(b.calls))).toHaveLength(0);
    const ok = fakeClient([empresaOk, linha({ exposure_type: 'eventual', assessment_type: 'qualitativa' }), [/SELECT r\.\*/, () => ({ rows: [{ id: R }] })]]);
    await expect(svc.atualizar(ok.client, ator, T, R, { status: 'completo' }, ctx)).resolves.toBeDefined();
  });

  it('copiar: risco de origem some durante a cópia ⇒ 409 (não TypeError); origem com mais de 500 ⇒ 409', async () => {
    const ghes: [RegExp, () => { rows: any[] }] = [/FROM pgr_ghes WHERE id = ANY/, () => ({ rows: [{ id: G }, { id: H1 }] })];
    const a = fakeClient([empresaOk, ghes, [/FROM pgr_risks WHERE ghe_id = \$1 AND tenant_id = \$2 ORDER BY created_at, id LIMIT \$3 FOR SHARE/, () => ({ rows: [{ id: R, hazard_id: null }] })],
      [/INSERT INTO pgr_risks/, () => ({ rows: [] })]]);
    await expect(svc.copiar(a.client, ator, T, G, { from_ghe_id: H1 }, ctx)).rejects.toBeInstanceOf(ConflictException);
    const muitos = Array.from({ length: 501 }, (_, i) => ({ id: `r${i}`, hazard_id: null }));
    const b = fakeClient([empresaOk, ghes, [/FOR SHARE/, () => ({ rows: muitos })]]);
    await expect(svc.copiar(b.client, ator, T, G, { from_ghe_id: H1 }, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(writes(b.calls)).toHaveLength(0);
  });

  it('medição em risco não quantitativo ⇒ 400', async () => {
    const { client, calls } = fakeClient([empresaOk, [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, assessment_type: 'qualitativa' }] })]]);
    await expect(svc.criarMedicao(client, ator, T, R, { agent: 'TESTE' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('medição com registro profissional não confirmado/inacessível ⇒ 400', async () => {
    const { client, calls } = fakeClient([empresaOk,
      [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, assessment_type: 'quantitativa' }] })],
      [/FROM professional_registrations/, () => ({ rows: [] })]]);
    await expect(svc.criarMedicao(client, ator, T, R, { agent: 'TESTE', professional_registration_id: H1 }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('controle: EPI inexistente ⇒ 400; epi em controle que não é EPI ⇒ 400', async () => {
    const risco: [RegExp, () => { rows: any[] }] = [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T }] })];
    const a = fakeClient([empresaOk, risco, [/FROM epi_catalog_items/, () => ({ rows: [] })]]);
    await expect(svc.criarControle(a.client, ator, T, R, { kind: 'epi', status: 'existente', description: 'TESTE', epi_catalog_item_id: H1 }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    const b = fakeClient([empresaOk, risco]);
    await expect(svc.criarControle(b.client, ator, T, R, { kind: 'epc', status: 'existente', description: 'TESTE', epi_catalog_item_id: H1 }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(a.calls).concat(writes(b.calls))).toHaveLength(0);
  });

  it('copiar para o mesmo GHE ⇒ 400; GHE de origem de outro tenant (não achado) ⇒ 404', async () => {
    const { client } = fakeClient([empresaOk]);
    await expect(svc.copiar(client, ator, T, G, { from_ghe_id: G }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.copiar(client, ator, T, G, { from_ghe_id: H1 }, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('desligar avaliação quantitativa com medições existentes ⇒ 409', async () => {
    const { client, calls } = fakeClient([empresaOk,
      [/FROM pgr_risks WHERE id = \$1 AND tenant_id = \$2/, () => ({ rows: [{ id: R, tenant_id: T, assessment_type: 'quantitativa' }] })],
      [/FROM pgr_risk_measurements WHERE risk_id/, () => ({ rows: [{ n: 2 }] })]]);
    await expect(svc.atualizar(client, ator, T, R, { assessment_type: 'qualitativa' }, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(writes(calls)).toHaveLength(0);
  });

  it('DTOs: rejeitam tenant_id/ghe_id/hazard_id, training_tipo fora do vocabulário, data inválida', () => {
    expect(erros(AtualizarRiscoDto, { name: 'x', tenant_id: T })).toContain('tenant_id');
    expect(erros(AtualizarRiscoDto, { ghe_id: G })).toContain('ghe_id');
    expect(erros(CriarControleDto, { kind: 'treinamento', status: 'existente', description: 'x', training_tipo: 'nr-99' })).toContain('training_tipo');
    expect(erros(CriarControleDto, { kind: 'treinamento', status: 'existente', description: 'x', training_tipo: 'nr-35' })).toEqual([]);
    expect(erros(CriarMedicaoDto, { agent: 'x', evaluated_on: '31/12/2025' })).toContain('evaluated_on');
    expect(erros(CriarMedicaoDto, { agent: 'x', evaluated_on: '2025-12-31' })).toEqual([]);
  });
});
