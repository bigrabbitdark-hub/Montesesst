import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getToken: vi.fn(() => 'tok-123') }));

import { getToken } from '@/lib/auth';
import { epiApi, epiPaths, clampPeriod, fetchBlob, openOrDownload, openBlankWindow, qs } from '../api';
import { EpiApiError, mapEpiError } from '../errors';

const fetchMock = vi.fn();
const ok = (body: unknown, status = 200) => ({ ok: true, status, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/pdf' : null) }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['pdf']) });
const fail = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body });
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit & { headers: Record<string, string> }];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getToken).mockReturnValue('tok-123');
});
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
});

describe('request (via epiApi)', () => {
  it('envia Authorization Bearer, no-store e prefixo /api', async () => {
    fetchMock.mockResolvedValue(ok({ epi_alert_days: 30 }));
    await epiApi.getSettings();
    const [url, init] = lastCall();
    expect(url).toBe('/api/epis/settings');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.cache).toBe('no-store');
  });
  it('sem token não envia Authorization', async () => {
    vi.mocked(getToken).mockReturnValue(null);
    fetchMock.mockResolvedValue(ok({ epi_alert_days: 30 }));
    await epiApi.getSettings();
    expect(lastCall()[1].headers.Authorization).toBeUndefined();
  });
  it('Content-Type JSON só quando há corpo', async () => {
    fetchMock.mockResolvedValue(ok({ epi_alert_days: 45 }));
    await epiApi.updateSettings(45, 't1');
    const [url, init] = lastCall();
    expect(url).toBe('/api/epis/settings?tenant_id=t1');
    expect(init.method).toBe('PATCH');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ epi_alert_days: 45 });
    await epiApi.getSettings();
    expect(lastCall()[1].headers['Content-Type']).toBeUndefined();
  });
  it('query string só com campos definidos (sem undefined, nulos nem vazios)', async () => {
    fetchMock.mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 25 }));
    await epiApi.searchEpis({ q: 'luva', status: 'ativo', stockBand: 'abaixo', page: 2, pageSize: 25, tenantId: undefined, category: undefined });
    const url = lastCall()[0];
    expect(url).toBe('/api/epis/search?q=luva&status=ativo&stock_band=abaixo&page=2&page_size=25');
    expect(url).not.toContain('undefined');
    await epiApi.searchEpis({});
    expect(lastCall()[0]).toBe('/api/epis/search');
    expect(qs({ a: '', b: null, c: undefined, d: 0 })).toBe('?d=0');
  });
  it('movements usa tenant_id e snake_case', async () => {
    fetchMock.mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 25 }));
    await epiApi.movements({ tenantId: 't1', tenantEpiId: 'e1', employeeId: 'f1', type: 'entrega', page: 1 });
    expect(lastCall()[0]).toBe('/api/epis/movements?tenant_id=t1&tenant_epi_id=e1&employee_id=f1&type=entrega&page=1');
  });
  it.each([401, 403, 404, 409])('resposta %i vira EpiApiError com status e mensagem do servidor', async (status) => {
    fetchMock.mockResolvedValue(fail(status, { message: 'Estoque insuficiente' }));
    const err = await epiApi.getSettings().catch((x) => x);
    expect(err).toBeInstanceOf(EpiApiError);
    expect(err.status).toBe(status);
    expect(err.serverMessage).toBe('Estoque insuficiente');
  });
  it('corpo de erro não JSON não derruba: status preservado e mensagem vazia', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } });
    const err = await epiApi.getSettings().catch((x) => x);
    expect(err).toBeInstanceOf(EpiApiError);
    expect([err.status, err.serverMessage]).toEqual([502, '']);
  });
  it('attempts_left numérico é repassado', async () => {
    fetchMock.mockResolvedValue(fail(400, { message: 'x', attempts_left: 2 }));
    const err = await epiApi.getSettings().catch((x) => x);
    expect(err.attemptsLeft).toBe(2);
  });
  it('2xx com corpo não vazio e não JSON vira erro de resposta inesperada (não "sem conexão")', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>oops</html>' });
    const err = await epiApi.getSettings().catch((x) => x);
    expect(err).toBeInstanceOf(EpiApiError);
    expect(mapEpiError(err)).toBe('Resposta inesperada do servidor. Atualize a tela e tente de novo.');
    expect(mapEpiError(err)).not.toContain('conectar');
  });
  it('2xx com corpo vazio (200 sem corpo) é sucesso e devolve undefined', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await expect(epiApi.deleteEpi('e1')).resolves.toBeUndefined();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '  \n' });
    await expect(epiApi.deleteEpi('e1')).resolves.toBeUndefined();
  });
  it('deleteEpi usa DELETE /epis/:id sem tenant_id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await epiApi.deleteEpi('e1');
    const [url, init] = lastCall();
    expect(url).toBe('/api/epis/e1');
    expect(init.method).toBe('DELETE');
  });
  it('204 devolve undefined sem ler o corpo', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('não ler'); } });
    await expect(epiApi.revokeSignatureRequest('id1')).resolves.toBeUndefined();
  });
  it('falha de rede propaga erro que o mapeador trata como conexão', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await epiApi.getSettings().catch((x) => x);
    expect(mapEpiError(err)).toContain('conectar ao servidor');
  });
  it('404 do dashboard (técnico sem visibilidade) vira "Registro não encontrado."', async () => {
    fetchMock.mockResolvedValue(fail(404, { message: 'Empresa não encontrada' }));
    const err = await epiApi.dashboard({ tenantId: 't1' }).catch((x) => x);
    expect(mapEpiError(err)).toBe('Registro não encontrado.');
  });
});

describe('employees', () => {
  it('descarta o cpf e demais campos sensíveis: só os campos não sensíveis chegam ao chamador', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'e1', full_name: 'João', cpf: '12345678901', registration_number: '001', department: 'Obra', position: null, status: 'ativo', salary: 1 }]));
    const r = await epiApi.employees('t1');
    expect(r).toEqual([{ id: 'e1', full_name: 'João', registration_number: '001', department: 'Obra', position: null, status: 'ativo' }]);
    expect(JSON.stringify(r)).not.toContain('12345678901');
    expect(r[0]).not.toHaveProperty('cpf');
  });
});

describe('caminhos e métodos reais do backend', () => {
  it('mapeia cada função para a rota do controller', async () => {
    fetchMock.mockResolvedValue(ok({}));
    const cases: Array<[() => Promise<unknown>, string, string]> = [
      [() => epiApi.createEpi({ epi_catalog_item_id: 'c', ca_number: '1' }), 'POST', '/api/epis'],
      [() => epiApi.updateEpi('e1', { status: 'inativo' }), 'PATCH', '/api/epis/e1'],
      [() => epiApi.lots('e1'), 'GET', '/api/epis/e1/lots'],
      [() => epiApi.catalog(), 'GET', '/api/epi-catalog-items'],
      [() => epiApi.caepiSearch(' 12345 '), 'GET', '/api/caepi/search?q=12345'],
      [() => epiApi.registerMovement('e1', { type: 'entrada', quantity: 1, idempotency_key: 'k1234567' }), 'POST', '/api/epis/e1/movements'],
      [() => epiApi.adjust('e1', { direction: 'mais', quantity: 1, reason: 'contagem', idempotency_key: 'k1234567' }), 'POST', '/api/epis/e1/adjustments'],
      [() => epiApi.reverse('m1', { reason: 'engano', idempotency_key: 'k1234567' }), 'POST', '/api/epis/movements/m1/reversal'],
      [() => epiApi.employees('t1'), 'GET', '/api/employees?tenant_id=t1'],
      [() => epiApi.fichaGet('f1', { from: '2026-01-01', signature_status: 'assinada' }), 'GET', '/api/epi-fichas/employees/f1?from=2026-01-01&signature_status=assinada'],
      [() => epiApi.fichaIssue('f1', { idempotency_key: 'k1234567' }), 'POST', '/api/epi-fichas/employees/f1/issue'],
      [() => epiApi.fichaDocuments('f1'), 'GET', '/api/epi-fichas/employees/f1/documents'],
      [() => epiApi.fichaVerify('d1'), 'GET', '/api/epi-fichas/documents/d1/verify'],
      [() => epiApi.createSignatureRequest({ employee_id: 'f1', idempotency_key: 'k1234567' }), 'POST', '/api/epi-signatures/requests'],
      [() => epiApi.listSignatureRequests('f1'), 'GET', '/api/epi-signatures/requests?employee_id=f1'],
      [() => epiApi.revokeSignatureRequest('r1'), 'POST', '/api/epi-signatures/requests/r1/revoke'],
      [() => epiApi.inPerson({ delivery_ids: ['d1'], witness_name: 'Maria', reason: 'presencial' }), 'POST', '/api/epi-signatures/in-person'],
      [() => epiApi.pending({ tenantId: 't1', page: 1, pageSize: 25 }), 'GET', '/api/epi-signatures/pending?tenant_id=t1&page=1&page_size=25'],
    ];
    for (const [fn, method, url] of cases) {
      await fn();
      const [calledUrl, init] = lastCall();
      expect(calledUrl).toBe(url);
      expect(init.method ?? 'GET').toBe(method);
    }
  });
  it('caminhos de PDF', () => {
    expect(epiPaths.fichaPreview('f1', { from: '2026-01-01' })).toBe('/epi-fichas/employees/f1/preview.pdf?from=2026-01-01');
    expect(epiPaths.fichaDownload('d1')).toBe('/epi-fichas/documents/d1/download');
    expect(epiPaths.receipt('s1')).toBe('/epi-signatures/s1/receipt.pdf');
  });
});

describe('período do dashboard (máximo 366 dias)', () => {
  it('janela acima de 366 dias recua o início para exatamente 366 dias antes do fim', () => {
    expect(clampPeriod('2020-01-01', '2026-10-18')).toEqual({ from: '2025-10-17', to: '2026-10-18' });
    expect(clampPeriod('2025-10-16', '2026-10-18')).toEqual({ from: '2025-10-17', to: '2026-10-18' });
  });
  it('janela dentro do limite é mantida', () => {
    expect(clampPeriod('2026-01-01', '2026-10-18')).toEqual({ from: '2026-01-01', to: '2026-10-18' });
    expect(clampPeriod('2025-10-17', '2026-10-18')).toEqual({ from: '2025-10-17', to: '2026-10-18' });
  });
  it('só "from" antigo usa hoje (São Paulo) como fim ao limitar', () => {
    const r = clampPeriod('2000-01-01', undefined, new Date('2026-10-18T12:00:00Z'));
    expect(r).toEqual({ from: '2025-10-17', to: undefined });
  });
  it('dashboard() nunca envia janela maior que 366 dias', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await epiApi.dashboard({ tenantId: 't1', from: '2019-01-01', to: '2026-10-18' });
    const url = new URL(lastCall()[0], 'http://x');
    expect(url.searchParams.get('from')).toBe('2025-10-17');
    expect(url.searchParams.get('to')).toBe('2026-10-18');
    expect(url.searchParams.get('tenant_id')).toBe('t1');
  });
  it('dashboard() sem período não envia from/to', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await epiApi.dashboard({});
    expect(lastCall()[0]).toBe('/api/epis/dashboard');
  });
});

describe('fetchBlob / openOrDownload', () => {
  it('fetchBlob envia Authorization e propaga erro como EpiApiError', async () => {
    fetchMock.mockResolvedValue(fail(404, { message: 'x' }));
    const err = await fetchBlob('/epi-fichas/documents/d1/download').catch((x) => x);
    expect(err).toBeInstanceOf(EpiApiError);
    expect(err.status).toBe(404);
    expect(lastCall()[1].headers.Authorization).toBe('Bearer tok-123');
  });
  it('modo open sem win: abre aba vazia (opener zerado), navega nela, revoga após 60 s e não baixa por âncora', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(ok(null));
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:abc');
    URL.revokeObjectURL = revoke;
    const w = { opener: 'x', location: { href: '' } } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(w);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const r = await openOrDownload('/x.pdf', { mode: 'open' });
    expect(r).toBe('opened');
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(w.opener).toBeNull();
    expect(w.location.href).toBe('blob:abc');
    expect(click).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
    open.mockRestore();
    click.mockRestore();
  });
  it('janela pré-aberta: navega a aba aberta no clique (sem novo window.open após o await)', async () => {
    fetchMock.mockResolvedValue(ok(null));
    URL.createObjectURL = () => 'blob:pre';
    URL.revokeObjectURL = vi.fn();
    const win = { closed: false, close: vi.fn(), location: { href: '' } } as unknown as Window;
    const open = vi.spyOn(window, 'open');
    const r = await openOrDownload('/x.pdf', { mode: 'open', win });
    expect(r).toBe('opened');
    expect(win.location.href).toBe('blob:pre');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it('janela pré-aberta fecha se o download falhar', async () => {
    fetchMock.mockResolvedValue(fail(500));
    const win = { closed: false, close: vi.fn(), location: { href: '' } } as unknown as Window;
    await expect(openOrDownload('/x.pdf', { mode: 'open', win })).rejects.toBeInstanceOf(EpiApiError);
    expect(win.close).toHaveBeenCalledTimes(1);
  });
  it('popup bloqueado (window.open retorna null): cai no download e avisa com "downloaded"', async () => {
    fetchMock.mockResolvedValue(ok(null));
    URL.createObjectURL = () => 'blob:blk';
    URL.revokeObjectURL = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const r = await openOrDownload('/x.pdf', { mode: 'open', filename: 'a.pdf' });
    expect(r).toBe('downloaded');
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(click).toHaveBeenCalledTimes(1);
    open.mockRestore();
    click.mockRestore();
  });
  it('openBlankWindow abre aba vazia e zera o opener', () => {
    const w = { opener: 'x' } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(w);
    expect(openBlankWindow()).toBe(w);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(w.opener).toBeNull();
    open.mockRestore();
  });
  it('modo download: clica num link com o nome do arquivo e o remove; revoga a URL', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(ok(null));
    const revoke = vi.fn();
    URL.createObjectURL = () => 'blob:zzz';
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('ficha.pdf');
      expect(this.href).toContain('blob:zzz');
    });
    await openOrDownload('/x.pdf', { mode: 'download', filename: 'ficha.pdf' });
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:zzz');
    click.mockRestore();
  });
  it('falha no download não cria URL temporária', async () => {
    fetchMock.mockResolvedValue(fail(500));
    const create = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    await expect(openOrDownload('/x.pdf', { mode: 'open' })).rejects.toBeInstanceOf(EpiApiError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('armazenamento', () => {
  it('nenhuma chamada grava em localStorage nem sessionStorage', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    fetchMock.mockResolvedValue(ok({}));
    await epiApi.dashboard({ tenantId: 't1' });
    await epiApi.searchEpis({ q: 'a' });
    await epiApi.createSignatureRequest({ employee_id: 'f1', idempotency_key: 'k1234567' });
    await fetchBlob('/x.pdf');
    expect(setLocal).not.toHaveBeenCalled();
    setLocal.mockRestore();
  });
});

describe('fetchBlob: só PDF', () => {
  const resp = (ct: string | null, body = '%PDF') => ({ ok: true, status: 200, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? ct : null) }, blob: async () => new Blob([body], { type: ct ?? '' }) });
  it('Content-Type text/html vira erro (resposta inesperada) e nunca vira Blob aberto', async () => {
    fetchMock.mockResolvedValue(resp('text/html; charset=utf-8', '<html>erro</html>'));
    const err = await fetchBlob('/x.pdf').catch((e) => e);
    expect(err).toBeInstanceOf(EpiApiError);
    expect(mapEpiError(err)).toBe('Resposta inesperada do servidor. Atualize a tela e tente de novo.');
  });
  it('janela pré-aberta é fechada quando o tipo não é PDF e a URL não é criada', async () => {
    fetchMock.mockResolvedValue(resp('text/html'));
    const create = vi.fn(() => 'blob:x');
    URL.createObjectURL = create;
    const win = { closed: false, close: vi.fn(), location: { href: '' } } as unknown as Window;
    await expect(openOrDownload('/x.pdf', { mode: 'open', win })).rejects.toBeInstanceOf(EpiApiError);
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
  it('application/pdf passa e o Blob sai com type application/pdf mesmo se o servidor mandou outro tipo no corpo', async () => {
    fetchMock.mockResolvedValue({ ...resp('application/pdf; qs=1'), blob: async () => new Blob(['%PDF'], { type: 'application/octet-stream' }) });
    const b = await fetchBlob('/x.pdf');
    expect(b.type).toBe('application/pdf');
  });
});

describe('fetchBlob: sem Content-Type', () => {
  it('resposta sem Content-Type (ou sem cabeçalhos) é recusada, não aberta', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, blob: async () => new Blob(['%PDF']) });
    await expect(fetchBlob('/x.pdf')).rejects.toBeInstanceOf(EpiApiError);
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['%PDF']) });
    await expect(fetchBlob('/x.pdf')).rejects.toBeInstanceOf(EpiApiError);
  });
});

describe('searchAllEpis', () => {
  it('percorre as páginas de 100 até o total e para sem pedir além', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));
    fetchMock
      .mockResolvedValueOnce(ok({ items: mk(100), total: 120, page: 1, page_size: 100 }))
      .mockResolvedValueOnce(ok({ items: mk(20), total: 120, page: 2, page_size: 100 }));
    const r = await epiApi.searchAllEpis('t1');
    expect(r.items).toHaveLength(120);
    expect(r.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');
    expect(fetchMock.mock.calls[1][0]).toContain('page_size=100');
  });
});
