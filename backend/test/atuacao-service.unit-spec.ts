import { AtuacaoService, CAMPOS_OPERACIONAIS } from '../src/atuacao/atuacao.service';

function montar(rows: Record<string, any[]>) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const chave = Object.keys(rows).find((k) => sql.includes(k));
      return { rows: chave ? rows[chave] : [], rowCount: chave ? rows[chave].length : 0 };
    }),
  };
  return { service: new AtuacaoService(), client, consultas };
}

describe('AtuacaoService', () => {
  it('só permite os 6 campos operacionais', () => {
    expect([...CAMPOS_OPERACIONAIS].sort()).toEqual(
      ['contact_name', 'contact_phone', 'contact_role', 'notes', 'sector', 'trade_name'],
    );
  });

  it('classifica situação via deriveAccessState e filtra por situacao', async () => {
    const { service, client } = montar({
      'FROM tenants t': [
        { id: 'a', name: 'A', has_authorized: true, has_recent_pending: false, has_lapsed: false },
        { id: 'b', name: 'B', has_authorized: false, has_recent_pending: false, has_lapsed: true },
      ],
    });
    const todos = await service.listar(client, {});
    expect(todos.map((c) => [c.id, c.situacao])).toEqual([['a', 'ativa'], ['b', 'inativa']]);
    const inativos = await service.listar(client, { situacao: 'inativa' });
    expect(inativos.map((c) => c.id)).toEqual(['b']);
  });

  it('resumo conta cada situação', async () => {
    const { service, client } = montar({
      'FROM tenants t': [
        { id: 'a', has_authorized: true, has_recent_pending: false, has_lapsed: false },
        { id: 'b', has_authorized: false, has_recent_pending: true, has_lapsed: false },
        { id: 'c', has_authorized: false, has_recent_pending: false, has_lapsed: false },
      ],
    });
    expect(await service.resumo(client)).toEqual({ total: 3, ativos: 1, trial: 1, pendentes: 1, inativos: 0 });
  });

  it('atualizar ignora campos fora da lista e nunca grava cnpj/plan/status/name', async () => {
    const { service, client, consultas } = montar({ 'UPDATE tenants': [{ id: 't1' }], 'FROM tenants t': [{ id: 't1', has_authorized: false, has_recent_pending: false, has_lapsed: false }] });
    await service.atualizarOperacional(client, 't1', { sector: 'Metal', cnpj: '1', plan: 'x', status: 'ativo', name: 'N' } as any);
    const update = consultas.find((c) => c.sql.includes('UPDATE tenants'))!;
    expect(update.sql).toContain('sector = $2');
    for (const proibido of ['cnpj', 'plan', 'status', 'name =']) expect(update.sql).not.toContain(proibido);
  });

  it('atualizar devolve NotFound quando o RLS esconde o tenant (0 linhas)', async () => {
    const { service, client } = montar({});
    await expect(service.atualizarOperacional(client, 't9', { sector: 'X' })).rejects.toThrow('Cliente não encontrado');
  });

  it('ficha traz responsaveis via list_socios()', async () => {
    const { service, client, consultas } = montar({
      'FROM tenants t': [{ id: 't1', name: 'T', plan: 'x', created_at: 'd', has_authorized: true, has_recent_pending: false, has_lapsed: false }],
      'list_socios()': [{ id: 'u1', full_name: 'Ana' }],
    });
    const f = await service.ficha(client, 't1');
    expect(f.responsaveis).toEqual([{ id: 'u1', full_name: 'Ana' }]);
    expect(consultas.some((c) => c.sql.includes('tenant_owners') && c.params[0] === 't1')).toBe(true);
  });

  it('listar com meus filtra por tenant_owners do usuário; sem meus não filtra', async () => {
    const { service, client, consultas } = montar({ 'FROM tenants t': [] });
    await service.listar(client, { meus: true }, 'user-1');
    const c = consultas[0];
    expect(c.sql).toContain('tenant_owners');
    expect(c.params).toContain('user-1');
    await service.listar(client, {}, 'user-1');
    expect(consultas[1].params).not.toContain('user-1');
  });

  it('definirResponsaveis: 400 se algum id não está em list_socios, 404 se tenant não é Montese; nunca grava nesses casos', async () => {
    const mk = (socios: any[], tenant: any[]) => {
      const sqls: string[] = [];
      const client: any = {
        query: jest.fn(async (sql: string) => {
          sqls.push(sql);
          if (sql.includes('is_montese_tenant')) return { rows: tenant, rowCount: tenant.length };
          if (sql.includes('list_socios()')) return { rows: socios, rowCount: socios.length };
          return { rows: [], rowCount: 0 };
        }),
      };
      return { client, sqls };
    };
    const svc = new AtuacaoService();
    const a = mk([], [{ '?column?': 1 }]);
    await expect(svc.definirResponsaveis(a.client, 't', ['u1'], 'adm')).rejects.toThrow('Responsável inválido');
    expect(a.sqls.some((s) => /DELETE|INSERT/.test(s))).toBe(false);
    const b = mk([{ id: 'u1', full_name: 'A' }], []);
    await expect(svc.definirResponsaveis(b.client, 't', ['u1'], 'adm')).rejects.toThrow('Cliente não encontrado');
    expect(b.sqls.some((s) => /DELETE|INSERT/.test(s))).toBe(false);
  });
});
