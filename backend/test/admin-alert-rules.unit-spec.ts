// Testes unitários puros das regras de alerta da Visão Geral do admin —
// sem banco, sem rede. Roda com `npm run test:unit -- admin-alert-rules`.
import { AlertInput, AlertResult, computeAlerts } from '../src/admin-dashboard/alert-rules';

function base(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    services: { postgres: true, redis: true, site: true },
    disk_used_percent: 40,
    ram_used_percent: 50,
    payments_rejected_7d: 0,
    payments_pending_stale: 0,
    documentos_vencendo: 0,
    epis_vencendo: 0,
    ...overrides,
  };
}

const ids = (r: AlertResult) => r.itens.map((i) => i.id);
const find = (r: AlertResult, id: string) => r.itens.find((i) => i.id === id);

describe('computeAlerts', () => {
  it('não gera alerta quando tudo está normal', () => {
    const r = computeAlerts(base());
    expect(r.itens).toEqual([]);
    expect(r.contagem).toEqual({ critico: 0, atencao: 0, info: 0 });
  });

  it.each([
    ['postgres', 'postgres_down', 'Banco de dados inacessível'],
    ['redis', 'redis_down', 'Redis inacessível'],
    ['site', 'site_down', 'Site inacessível'],
  ] as const)('serviço %s fora do ar gera alerta crítico', (service, id, titulo) => {
    const r = computeAlerts(base({ services: { postgres: true, redis: true, site: true, [service]: false } }));
    expect(ids(r)).toEqual([id]);
    expect(find(r, id)).toMatchObject({ severidade: 'critico', titulo, href: '/admin/overview' });
    expect(r.contagem).toEqual({ critico: 1, atencao: 0, info: 0 });
  });

  it.each([
    [79.99, null],
    [80, 'atencao'],
    [89.99, 'atencao'],
    [90, 'critico'],
    [100, 'critico'],
  ] as const)('disco em %s%% -> %s', (pct, severidade) => {
    const item = find(computeAlerts(base({ disk_used_percent: pct })), 'disk_high');
    if (severidade === null) expect(item).toBeUndefined();
    else expect(item?.severidade).toBe(severidade);
  });

  it('formata o percentual do disco arredondado no título', () => {
    expect(find(computeAlerts(base({ disk_used_percent: 84.4 })), 'disk_high')?.titulo).toBe('Disco em 84%');
  });

  it.each([
    [89.99, null],
    [90, 'atencao'],
    [94.99, 'atencao'],
    [95, 'critico'],
  ] as const)('RAM em %s%% -> %s', (pct, severidade) => {
    const item = find(computeAlerts(base({ ram_used_percent: pct }), { ramEnabled: true }), 'ram_high');
    if (severidade === null) expect(item).toBeUndefined();
    else expect(item?.severidade).toBe(severidade);
  });

  it('não avalia RAM quando a regra está desligada', () => {
    const r = computeAlerts(base({ ram_used_percent: 99 }), { ramEnabled: false });
    expect(find(r, 'ram_high')).toBeUndefined();
  });

  it('cobranças recusadas: singular e plural', () => {
    expect(find(computeAlerts(base({ payments_rejected_7d: 1 })), 'payments_rejected')).toMatchObject({
      severidade: 'atencao',
      titulo: '1 cobrança recusada nos últimos 7 dias',
      href: '/admin/financeiro',
    });
    expect(find(computeAlerts(base({ payments_rejected_7d: 3 })), 'payments_rejected')?.titulo).toBe(
      '3 cobranças recusadas nos últimos 7 dias',
    );
    expect(find(computeAlerts(base({ payments_rejected_7d: 0 })), 'payments_rejected')).toBeUndefined();
  });

  it('cobranças pendentes há mais de 3 dias: singular e plural', () => {
    expect(find(computeAlerts(base({ payments_pending_stale: 1 })), 'payments_pending_stale')).toMatchObject({
      severidade: 'atencao',
      titulo: '1 cobrança pendente há mais de 3 dias',
    });
    expect(find(computeAlerts(base({ payments_pending_stale: 2 })), 'payments_pending_stale')?.titulo).toBe(
      '2 cobranças pendentes há mais de 3 dias',
    );
  });

  it('documentos e EPIs vencendo são informativos', () => {
    const r = computeAlerts(base({ documentos_vencendo: 5, epis_vencendo: 1 }));
    expect(find(r, 'documents_expiring')).toMatchObject({
      severidade: 'info',
      titulo: '5 documentos vencem em 30 dias',
      href: '/admin/empresas',
    });
    expect(find(r, 'epis_expiring')?.titulo).toBe('1 EPI com CA vencendo em 30 dias');
    expect(r.contagem).toEqual({ critico: 0, atencao: 0, info: 2 });
    expect(find(computeAlerts(base({ documentos_vencendo: 1 })), 'documents_expiring')?.titulo).toBe(
      '1 documento vence em 30 dias',
    );
    expect(find(computeAlerts(base({ epis_vencendo: 4 })), 'epis_expiring')?.titulo).toBe(
      '4 EPIs com CA vencendo em 30 dias',
    );
  });

  it('ordena crítico antes de atenção antes de info, independente da ordem das regras', () => {
    const r = computeAlerts(
      base({ disk_used_percent: 85, ram_used_percent: 96, documentos_vencendo: 2 }),
      { ramEnabled: true },
    );
    expect(ids(r)).toEqual(['ram_high', 'disk_high', 'documents_expiring']);
    expect(r.contagem).toEqual({ critico: 1, atencao: 1, info: 1 });
  });
});
