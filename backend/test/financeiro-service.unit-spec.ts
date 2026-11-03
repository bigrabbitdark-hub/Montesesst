import { NotFoundException } from '@nestjs/common';
import { FinanceiroService } from '../src/atuacao/financeiro.service';

// Cliente pg mockado: cada consulta do serviço carrega um marcador `/* fin:x */`.
function montar(rows: Record<string, any[]>) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const chave = Object.keys(rows).find((k) => sql.includes(`/* fin:${k} */`));
      const r = chave ? rows[chave] : [];
      return { rows: r, rowCount: r.length };
    }),
  };
  return { service: new FinanceiroService(), client, consultas };
}

const linha = (o: any) => ({ has_authorized: false, has_recent_pending: false, has_lapsed: false, ...o });
const cheias = {
  resumo: [{ hoje_cobrado_cents: 1, hoje_aprovado_cents: 2, hoje_pendente_cents: 3, mes_cobrado_cents: 4, mes_aprovado_cents: 5, mes_pendente_cents: 6, mes_recusado_cents: 7 }],
  serie: [{ data: '2026-10-20', cobrado_cents: 1, aprovado_cents: 1 }],
  mrr: [{ price_cents: 29900 }, { price_cents: 100 }],
};

describe('FinanceiroService', () => {
  it('resumo: classifica via deriveAccessState, conta pendência, soma MRR e monta o formato', async () => {
    const { service, client } = montar({
      ...cheias,
      clientes: [
        linha({ id: 'a', has_authorized: true, up_status: 'approved' }),
        linha({ id: 'b', has_authorized: true, up_status: 'rejected' }),
        linha({ id: 'c', has_recent_pending: true, up_status: 'rejected' }),
        linha({ id: 'd', has_lapsed: true }),
        linha({ id: 'e' }),
      ],
    });
    const r = await service.resumo(client, 30);
    expect(r.periodo_dias).toBe(30);
    expect(r.clientes).toEqual({ total: 5, ativos: 2, trial: 1, pendentes: 1, inativos: 1, com_pendencia: 1 });
    expect(r.mrr_cents).toBe(30000);
    expect(r.hoje).toEqual({ cobrado_cents: 1, aprovado_cents: 2, pendente_cents: 3 });
    expect(r.mes).toEqual({ cobrado_cents: 4, aprovado_cents: 5, pendente_cents: 6, recusado_cents: 7 });
    expect(r.serie).toEqual(cheias.serie);
  });

  it('resumo: só assinaturas de tenant (defesa no SQL) e série no fuso de São Paulo', async () => {
    const { service, client, consultas } = montar({ ...cheias, clientes: [] });
    await service.resumo(client, 7);
    for (const c of consultas.filter((q) => /FROM (payment_events|subscriptions)/.test(q.sql) || q.sql.includes('JOIN subscriptions'))) {
      expect(c.sql).toContain('tenant_id IS NOT NULL');
    }
    const serie = consultas.find((c) => c.sql.includes('fin:serie'))!;
    expect(serie.sql).toContain('America/Sao_Paulo');
    expect(serie.params[0]).toBe(7);
  });

  it('listar: filtros no SQL e LIMIT 200 depois do filtro', async () => {
    const { service, client, consultas } = montar({ lista: [] });
    await service.listar(client, { q: 'ac_me%x\\', situacao: 'ativa', pendencia: 'true' });
    const c = consultas[0];
    const iWhere = c.sql.lastIndexOf('WHERE');
    const iLimit = c.sql.indexOf('LIMIT 200');
    expect(iWhere).toBeGreaterThan(-1);
    expect(iLimit).toBeGreaterThan(iWhere);
    expect(c.sql).toContain('ILIKE');
    expect(c.sql).toContain('tenant_id IS NOT NULL');
    // escape de \ % _ como em atuacao.service.ts
    expect(c.params).toContain('%ac\\_me\\%x\\\\%');
    expect(c.params).toContain('ativa');
    expect(c.params).toContainEqual(['approved']);
  });

  it('listar sem filtros passa nulos (filtro neutro no SQL)', async () => {
    const { service, client, consultas } = montar({ lista: [] });
    await service.listar(client, {});
    expect(consultas[0].params.slice(0, 3)).toEqual([null, null, false]);
  });

  it('listar: DTO com pendência, atraso e sem chaves mercadopago_*', async () => {
    const { service, client } = montar({
      lista: [
        linha({ id: 'a', name: 'A', trade_name: null, has_authorized: true, hoje: '2026-10-20', plano: 'Start', valor_mensal_cents: 29900,
          up_data: '2026-10-17', up_status: 'rejected', up_valor_cents: 29900, mercadopago_payment_id: 'X', mercadopago_preapproval_id: 'Y' }),
        linha({ id: 'b', name: 'B', trade_name: 'Bê', has_authorized: true, hoje: '2026-10-20', plano: 'Start', valor_mensal_cents: 29900,
          up_data: '2026-10-20', up_status: 'approved', up_valor_cents: 29900 }),
        linha({ id: 'c', name: 'C', trade_name: null, hoje: '2026-10-20', plano: null, valor_mensal_cents: null, up_data: null, up_status: null, up_valor_cents: null }),
      ],
    });
    const r = await service.listar(client, {});
    expect(r[0]).toEqual({
      id: 'a', name: 'A', trade_name: null, situacao: 'ativa', plano: 'Start', valor_mensal_cents: 29900,
      ultimo_pagamento: { data: '2026-10-17', status: 'rejected', valor_cents: 29900 }, pendencia: true, dias_em_atraso: 3,
    });
    expect(r[1].pendencia).toBe(false);
    expect(r[1].dias_em_atraso).toBeNull();
    expect(r[2]).toMatchObject({ situacao: 'trial', ultimo_pagamento: null, pendencia: false, plano: null, valor_mensal_cents: null });
    expect(JSON.stringify(r)).not.toMatch(/mercadopago/i);
  });

  it('ficha: 404 quando o RLS esconde o cliente', async () => {
    const { service, client } = montar({});
    await expect(service.ficha(client, 't9')).rejects.toThrow(new NotFoundException('Cliente não encontrado'));
  });

  it('ficha: assinaturas e 24 últimos pagamentos, sem mercadopago_*', async () => {
    const { service, client, consultas } = montar({
      lista: [linha({ id: 't1', name: 'T', trade_name: null, has_authorized: true, hoje: '2026-10-20', plano: 'Start', valor_mensal_cents: 100,
        up_data: '2026-10-20', up_status: 'approved', up_valor_cents: 100 })],
      assinaturas: [{ plano: 'Start', status: 'authorized', valor_mensal_cents: 100, desde: '2026-01-01', mercadopago_preapproval_id: 'Z' }],
      pagamentos: [{ data: '2026-10-20', status: 'approved', valor_cents: 100, mercadopago_payment_id: 'W' }],
    });
    const f = await service.ficha(client, 't1');
    expect(f.assinaturas).toEqual([{ plano: 'Start', status: 'authorized', valor_mensal_cents: 100, desde: '2026-01-01' }]);
    expect(f.pagamentos).toEqual([{ data: '2026-10-20', status: 'approved', valor_cents: 100 }]);
    expect(JSON.stringify(f)).not.toMatch(/mercadopago/i);
    expect(consultas.find((c) => c.sql.includes('fin:pagamentos'))!.sql).toContain('LIMIT 24');
    expect(consultas.find((c) => c.sql.includes('fin:pagamentos'))!.sql).not.toMatch(/SELECT \*/);
  });
});
