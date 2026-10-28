import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PerigosService } from '../src/atuacao/pgr/perigos.service';
import { AtualizarPerigoDto, CriarPerigoDto } from '../src/atuacao/pgr/dto/perigo.dto';
import { AtualizarRiscoDto } from '../src/atuacao/pgr/dto/risco.dto';

// Unitário do serviço da biblioteca de perigos (PGR A, Task 3) com cliente pg falso.
type Q = { sql: string; params: unknown[] };
function fakeClient(handlers: Array<[RegExp, (p: unknown[]) => { rows: any[] } | Error]>) {
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
const socio = { id: 'u-socio', role: 'socio' };
const admin = { id: 'u-admin', role: 'admin' };
const ctx = { role: 'x', method: 'POST', path: '/atuacao/pgr/perigos', ip: '1.1.1.1' };
const T = '11111111-1111-4111-8111-111111111111';
const pgDup = Object.assign(new Error('dup'), { code: '23505', constraint: 'pgr_hazards_unique_name' });
const inserts = (calls: Q[]) => calls.filter((c) => /INSERT INTO pgr_hazards/.test(c.sql));
const audits = (calls: Q[]) => calls.filter((c) => /INSERT INTO audit_log/.test(c.sql));

describe('PerigosService', () => {
  const svc = new PerigosService();
  const empresaOk: [RegExp, () => { rows: any[] }] = [/FROM tenants t WHERE/, () => ({ rows: [{ id: T }] })];
  const insOk: [RegExp, () => { rows: any[] }] = [/INSERT INTO pgr_hazards/, () => ({ rows: [{ id: 'h1', scope: 'tenant', category: 'fisico' }] })];

  it('sócio não cria perigo global (403) e nada é gravado', async () => {
    const { client, calls } = fakeClient([]);
    await expect(svc.criar(client, socio, { scope: 'global', category: 'fisico', name: 'TESTE x' }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(inserts(calls)).toHaveLength(0);
  });

  it('sócio sem tenant_id ⇒ 400; tenant invisível ⇒ 404', async () => {
    const a = fakeClient([]);
    await expect(svc.criar(a.client, socio, { category: 'fisico', name: 'TESTE x' }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    const b = fakeClient([[/FROM tenants t WHERE/, () => ({ rows: [] })]]);
    await expect(svc.criar(b.client, socio, { tenant_id: T, category: 'fisico', name: 'TESTE x' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(inserts(b.calls)).toHaveLength(0);
  });

  it('admin sem tenant_id cria global; auditoria na mesma conexão só com ids e nomes de campos', async () => {
    const { client, calls } = fakeClient([insOk]);
    await svc.criar(client, admin, { category: 'fisico', name: 'TESTE segredo', description: 'texto livre sigiloso' }, ctx);
    const ins = inserts(calls)[0];
    expect(ins.params).toContain('global');
    const a = audits(calls);
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('pgr.hazard.created');
    const detail = a[0].params.filter((p) => typeof p === 'string').join('|');
    expect(detail).not.toContain('sigiloso');
    expect(detail).not.toContain('TESTE segredo');
    expect(detail).toContain('description');
  });

  it('nome duplicado (23505) ⇒ 409', async () => {
    const { client } = fakeClient([empresaOk, [/INSERT INTO pgr_hazards/, () => pgDup]]);
    await expect(svc.criar(client, socio, { tenant_id: T, category: 'fisico', name: 'TESTE x' }, ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  it('PATCH vazio ⇒ 400; null em name ⇒ 400', async () => {
    const { client } = fakeClient([]);
    await expect(svc.atualizar(client, admin, 'h1', {}, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.atualizar(client, admin, 'h1', { name: null as any }, ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sócio não edita nem inativa perigo global (403)', async () => {
    const h = [/FROM pgr_hazards WHERE id/, () => ({ rows: [{ id: 'h1', scope: 'global', tenant_id: null, category: 'fisico', name: 'TESTE g' }] })] as [RegExp, () => { rows: any[] }];
    const a = fakeClient([h]);
    await expect(svc.atualizar(a.client, socio, 'h1', { name: 'novo' }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.definirAtivo(a.client, socio, 'h1', false, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.calls.filter((c) => /UPDATE pgr_hazards/.test(c.sql))).toHaveLength(0);
  });

  it('inexistente/invisível ⇒ 404', async () => {
    const { client } = fakeClient([]);
    await expect(svc.obter(client, admin, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('importar: linha inválida ⇒ 400 com relatório, nada gravado', async () => {
    const { client, calls } = fakeClient([]);
    const itens = [
      { category: 'fisico', name: 'TESTE a' },
      { category: 'inexistente', name: 'TESTE b' },
      { category: 'fisico', name: 'TESTE a' },
      { category: 'quimico', name: 'TESTE c', esocial_code: 'x'.repeat(21) },
      { category: 'quimico', name: 'TESTE d', campo_estranho: 1 },
    ];
    const err: any = await svc.importar(client, admin, { itens }, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const erros = err.getResponse().erros as Array<{ linha: number; campos: string[] }>;
    expect(erros.map((e) => e.linha)).toEqual([2, 3, 4, 5]);
    expect(inserts(calls)).toHaveLength(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it('importar: mais de 500 itens ⇒ 400; só admin importa', async () => {
    const { client } = fakeClient([]);
    const muitos = Array.from({ length: 501 }, (_, i) => ({ category: 'fisico', name: `TESTE ${i}` }));
    await expect(svc.importar(client, admin, { itens: muitos }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.importar(client, socio, { itens: [{ category: 'fisico', name: 'TESTE' }] }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('importar válido: insere todos com origem importado e 1 auditoria', async () => {
    const { client, calls } = fakeClient([]);
    const r = await svc.importar(client, admin, { itens: [{ category: 'fisico', name: 'TESTE a' }, { category: 'quimico', name: 'TESTE b' }] }, ctx);
    expect(r).toEqual({ importados: 2 });
    expect(inserts(calls)).toHaveLength(2);
    expect(inserts(calls)[0].sql).toContain("'importado'");
    expect(audits(calls)).toHaveLength(1);
  });

  it('atualizar: coluna fora da allowlist ⇒ 400 antes de qualquer consulta', async () => {
    const { client, calls } = fakeClient([]);
    await expect(svc.atualizar(client, admin, 'h1', { tenant_id: T, name: 'x' } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.atualizar(client, admin, 'h1', { 'origin = origin, scope': 'global' } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('empresa e perigo só existem para cliente Montese (is_montese_tenant) para qualquer papel', async () => {
    const a = fakeClient([]);
    await expect(svc.criar(a.client, admin, { tenant_id: T, category: 'fisico', name: 'x' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(a.calls[0].sql).toContain('is_montese_tenant');
    const b = fakeClient([]);
    await svc.obter(b.client, admin, 'x').catch(() => undefined);
    expect(b.calls[0].sql).toContain('is_montese_tenant');
  });

  it('listar: sócio sem tenantId só global; admin sem tenantId global + Montese', async () => {
    const a = fakeClient([]);
    await svc.listar(a.client, socio, {});
    expect(a.calls[0].sql).toContain("scope = 'global'");
    expect(a.calls[0].sql).not.toContain('is_montese_tenant');
    const b = fakeClient([]);
    await svc.listar(b.client, admin, {});
    expect(b.calls[0].sql).toContain("is_montese_tenant(tenant_id)");
  });

  it('obter: sócio não lê perigo de empresa sem tenantId (404); com o tenantId certo lê', async () => {
    const h: [RegExp, () => { rows: any[] }] = [/FROM pgr_hazards WHERE id/, () => ({ rows: [{ id: 'h1', scope: 'tenant', tenant_id: T }] })];
    const { client } = fakeClient([h]);
    await expect(svc.obter(client, socio, 'h1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.obter(client, socio, 'h1', T)).resolves.toMatchObject({ id: 'h1' });
    await expect(svc.obter(client, admin, 'h1')).resolves.toMatchObject({ id: 'h1' });
  });

  it('duplicar: admin de perigo de empresa sem tenant_id exige para_global (400); com ele cria global e audita só o nome do campo', async () => {
    const h: [RegExp, () => { rows: any[] }] = [/FROM pgr_hazards WHERE id/, () => ({ rows: [{ id: 'h1', scope: 'tenant', tenant_id: T, category: 'fisico', name: 'TESTE o' }] })];
    const a = fakeClient([h]);
    await expect(svc.duplicar(a.client, admin, 'h1', {}, ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(inserts(a.calls)).toHaveLength(0);
    const b = fakeClient([h, [/INSERT INTO pgr_hazards/, () => ({ rows: [{ id: 'h2', scope: 'global' }] })]]);
    await svc.duplicar(b.client, admin, 'h1', { para_global: true }, ctx);
    expect(inserts(b.calls)[0].params[0]).toBe('global');
    expect(audits(b.calls)[0].params.join('|')).toContain('para_global');
  });

  it('exportar: busca limite+1 e marca truncado, devolvendo no máximo 5000', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ name: `n${i}` }));
    const { client, calls } = fakeClient([[/FROM pgr_hazards/, () => ({ rows })]]);
    const r = await svc.exportar(client, admin, {});
    expect(calls[0].sql).toContain('LIMIT 5001');
    expect(r.truncado).toBe(true);
    expect(r.itens).toHaveLength(5000);
    const ok = await svc.exportar(fakeClient([[/FROM pgr_hazards/, () => ({ rows: rows.slice(0, 3) })]]).client, admin, {});
    expect(ok.truncado).toBe(false);
  });

  describe('psychosocial (DTO)', () => {
    const erros = (cls: any, o: object) => validateSync(plainToInstance(cls, o), { whitelist: true, forbidNonWhitelisted: true });
    const base = { category: 'psicossocial', name: 'TESTE p' };
    it('aceita só as 5 chaves, valores texto até 2000', () => {
      expect(erros(CriarPerigoDto, { ...base, psychosocial: { jornada: 'ok', metas: 'ok' } })).toHaveLength(0);
      expect(erros(CriarPerigoDto, { ...base, psychosocial: null })).toHaveLength(0);
      expect(erros(CriarPerigoDto, { ...base, psychosocial: { outra: 'x' } })).not.toHaveLength(0);
      expect(erros(CriarPerigoDto, { ...base, psychosocial: { jornada: 'x'.repeat(2001) } })).not.toHaveLength(0);
      expect(erros(CriarPerigoDto, { ...base, psychosocial: { jornada: { a: 1 } } })).not.toHaveLength(0);
      expect(erros(CriarPerigoDto, { ...base, psychosocial: ['jornada'] })).not.toHaveLength(0);
      expect(erros(AtualizarPerigoDto, { psychosocial: { x: 'y' } })).not.toHaveLength(0);
      expect(erros(AtualizarRiscoDto, { psychosocial: { x: 'y' } })).not.toHaveLength(0);
      expect(erros(AtualizarRiscoDto, { psychosocial: { violencia_assedio: 'y' } })).toHaveLength(0);
    });
  });
});
