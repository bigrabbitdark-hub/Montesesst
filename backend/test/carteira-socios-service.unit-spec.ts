import { ConflictException, NotFoundException } from '@nestjs/common';
import { CarteiraSociosService } from '../src/admin/carteira-socios/carteira-socios.service';

const CTX = { role: 'admin', method: 'PUT', path: '/admin/carteira-socios/t1', ip: '127.0.0.1' };
const TID = '11111111-1111-4111-8111-111111111111';

type Linha = Record<string, any>;
function montar(opts: { tenant?: Linha | null; item?: Linha; inserido?: boolean; falhaAuditoria?: boolean; deletou?: boolean; lista?: Linha[]; total?: number }) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('INSERT INTO audit_log') && opts.falhaAuditoria) throw new Error('falha simulada da auditoria');
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('count(*)::int AS total')) return { rows: [{ total: opts.total ?? 0 }], rowCount: 1 };
      if (sql.includes('LIMIT')) return { rows: opts.lista ?? [], rowCount: (opts.lista ?? []).length };
      if (sql.includes('DELETE FROM socio_portfolio')) return { rows: [], rowCount: opts.deletou ? 1 : 0 };
      if (sql.includes('INSERT INTO socio_portfolio')) return { rows: [{ inserido: opts.inserido !== false }], rowCount: 1 };
      if (sql.includes('WHERE t.id = $1')) {
        const r = opts.tenant === null ? [] : [opts.tenant ?? opts.item];
        return { rows: r, rowCount: r.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { service: new CarteiraSociosService(), client, consultas };
}
const base = { tenant_id: TID, nome: 'Empresa X', cnpj: '12345678000199', tecnicos: 0, parceiros: 0, marcada: false, added_at: null, note: null, marcada_por_nome: null };
const comVinculo = { ...base, tecnicos: 1 };
const marcada = { ...comVinculo, marcada: true, added_at: new Date('2026-10-29T10:00:00Z'), note: 'segredo-da-nota', marcada_por_nome: 'Admin Fulano' };
const audits = (c: { sql: string; params: any[] }[]) => c.filter((x) => x.sql.includes('INSERT INTO audit_log'));

describe('CarteiraSociosService.marcar', () => {
  it('empresa inexistente => 404 e nada é gravado', async () => {
    const { service, client, consultas } = montar({ tenant: null });
    await expect(service.marcar(client, 'adm', TID, undefined, CTX)).rejects.toBeInstanceOf(NotFoundException);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
  });
  it('automática (sem vínculos, não marcada) => 409 sem gravar', async () => {
    const { service, client, consultas } = montar({ tenant: base });
    await expect(service.marcar(client, 'adm', TID, undefined, CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
  });
  it('com vínculo: trava, grava com added_by do admin e audita só o id (sem nota)', async () => {
    const { service, client, consultas } = montar({ tenant: comVinculo, inserido: true });
    const out = await service.marcar(client, 'adm-1', TID, 'segredo-da-nota', CTX);
    const ins = consultas.find((c) => c.sql.includes('INSERT INTO socio_portfolio'))!;
    expect(ins.params).toContain('adm-1');
    expect(consultas.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'))).toBeLessThan(consultas.indexOf(ins));
    const a = audits(consultas);
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('carteira.added');
    expect(JSON.stringify(a[0].params)).not.toContain('segredo-da-nota');
    expect(JSON.stringify(a[0].params)).toContain(TID);
    expect(out.tenant_id).toBe(TID);
  });
  it('idempotente: já marcada (sem mudar a nota) não duplica auditoria', async () => {
    const { service, client, consultas } = montar({ tenant: marcada, inserido: false });
    const out = await service.marcar(client, 'adm-1', TID, undefined, CTX);
    expect(audits(consultas)).toHaveLength(0);
    expect(out.origem).toBe('explicita');
  });
  it('falha da auditoria propaga (fail-closed)', async () => {
    const { service, client } = montar({ tenant: comVinculo, inserido: true, falhaAuditoria: true });
    await expect(service.marcar(client, 'adm-1', TID, undefined, CTX)).rejects.toThrow('falha simulada');
  });
});

describe('CarteiraSociosService.desmarcar', () => {
  it('não marcada => 404 sem auditoria', async () => {
    const { service, client, consultas } = montar({ deletou: false });
    await expect(service.desmarcar(client, 'adm', TID, { ...CTX, method: 'DELETE' })).rejects.toBeInstanceOf(NotFoundException);
    expect(audits(consultas)).toHaveLength(0);
  });
  it('marcada => remove e audita carteira.removed com o id', async () => {
    const { service, client, consultas } = montar({ deletou: true, tenant: comVinculo });
    await service.desmarcar(client, 'adm', TID, { ...CTX, method: 'DELETE' });
    const a = audits(consultas);
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('carteira.removed');
    expect(JSON.stringify(a[0].params)).toContain(TID);
  });
  it('falha da auditoria propaga', async () => {
    const { service, client } = montar({ deletou: true, tenant: comVinculo, falhaAuditoria: true });
    await expect(service.desmarcar(client, 'adm', TID, CTX)).rejects.toThrow('falha simulada');
  });
});

describe('CarteiraSociosService.listar', () => {
  it('escapa %, _ e \\ na busca e usa 100 por página', async () => {
    const { service, client, consultas } = montar({ lista: [], total: 0 });
    await service.listar(client, { q: 'a%b_c\\d', page: 3 });
    const q = consultas.find((c) => c.sql.includes('LIMIT'))!;
    expect(q.params).toContain('%a\\%b\\_c\\\\d%');
    expect(q.sql).toContain('ESCAPE');
    expect(q.params).toContain(100);
    expect(q.params).toContain(200);
  });
  it('mapeia origem e vínculos', async () => {
    const lista = [
      { ...base, origem: 'automatica' },
      { ...marcada, origem: 'explicita' },
      { ...comVinculo, origem: 'fora' },
    ];
    const { service, client } = montar({ lista, total: 3 });
    const out = await service.listar(client, {});
    expect(out).toMatchObject({ total: 3, page: 1, page_size: 100 });
    expect(out.itens.map((i) => i.origem)).toEqual(['automatica', 'explicita', 'fora']);
    expect(out.itens[1]).toMatchObject({ vinculos: { tecnicos: 1, parceiros: 0 }, marcada_por_nome: 'Admin Fulano', note: 'segredo-da-nota' });
    expect(out.itens[0]).not.toHaveProperty('marcada_por_nome');
  });
});
