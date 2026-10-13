import { TenantsService } from '../src/tenants/tenants.service';

// Cliente falso: captura o UPDATE e devolve a linha "gravada".
function clienteFalso(linha: Record<string, unknown>) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (/^\s*UPDATE tenants/.test(sql)) return { rows: [linha] };
    return { rows: [] };
  });
  return { client: { query } as any, query };
}

describe('TenantsService.update — observação e campos do CNPJ', () => {
  const service = new TenantsService({} as any);

  it('grava notes na coluna notes e não toca em trade_name nem em cnpj/name', async () => {
    const { client, query } = clienteFalso({ id: 't1', notes: 'Obra com 3 turnos', trade_name: 'Antiga' });
    const tenant = await service.update(client, 't1', { notes: 'Obra com 3 turnos' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SET\s+"?notes"?\s*=\s*\$2/);
    expect(sql).not.toMatch(/trade_name|cnpj|\bname\b\s*=/);
    expect(params).toEqual(['t1', 'Obra com 3 turnos']);
    expect(tenant.notes).toBe('Obra com 3 turnos');
    expect(tenant.trade_name).toBe('Antiga');
  });

  it('grava bairro, complemento e CNAE', async () => {
    const { client, query } = clienteFalso({ id: 't1' });
    await service.update(client, 't1', {
      address_neighborhood: 'Centro',
      address_complement: 'Sala 4',
      cnae_code: '4120400',
      cnae_description: 'Construção de edifícios',
    });
    const sql = (query.mock.calls[0] as [string])[0];
    for (const col of ['address_neighborhood', 'address_complement', 'cnae_code', 'cnae_description']) {
      expect(sql).toContain(col);
    }
  });

  it('payload antigo (só trade_name) continua funcionando', async () => {
    const { client, query } = clienteFalso({ id: 't1', trade_name: 'X' });
    await service.update(client, 't1', { trade_name: 'X' });
    expect((query.mock.calls[0] as [string])[0]).toContain('trade_name');
  });
});
