import { NotFoundException } from '@nestjs/common';

// Sem rede: o DNS é simulado (host público). A guarda deve funcionar sem depender do DNS real.
jest.mock('dns/promises', () => ({
  lookup: jest.fn(async (host: string) =>
    host === 'interno.exemplo.com.br' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '200.10.10.10', family: 4 }],
  ),
}));

import { NormativeMonitorService, mensagemDeErro } from '../src/normative/normative-monitor.service';

const PAGINA = `<html><body><div id="content-core">${'Texto da norma regulamentadora. '.repeat(20)}</div></body></html>`;

function montar(opcoes: { fonte?: { id: string; code: string | null; title: string; official_url: string } | null; vigenteChars?: number | null; recorded?: any } = {}) {
  const fonte = opcoes.fonte === undefined ? { id: 's1', code: 'NR-06', title: 'EPI', official_url: 'https://exemplo.gov.br/nr06.htm' } : opcoes.fonte;
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM official_sources')) return { rows: fonte ? [fonte] : [] };
      if (sql.includes('length(raw_text)')) return { rows: opcoes.vigenteChars == null ? [] : [{ len: opcoes.vigenteChars }] };
      if (sql.includes("last_check_status = 'erro'")) return { rows: [{ consecutive_failures: 1 }] };
      return { rows: [] };
    }),
  };
  const db: any = { withoutTenantContext: jest.fn(async (cb: any) => cb(client)) };
  const documents: any = { recordDetectedVersion: jest.fn(async () => (opcoes.recorded === undefined ? null : opcoes.recorded)) };
  const email: any = { send: jest.fn(async () => undefined) };
  const service = new NormativeMonitorService(db, documents, email);
  const falhas = () => consultas.filter((c) => c.sql.includes("last_check_status = 'erro'"));
  const sucessos = () => consultas.filter((c) => c.sql.includes("last_check_status = 'ok'"));
  return { service, documents, email, falhas, sucessos };
}

const servir = (html: string, init: ResponseInit = { status: 200, headers: { 'content-type': 'text/html' } }) =>
  jest.spyOn(global, 'fetch' as any).mockImplementation(async () => new Response(html, init) as any);

describe('NormativeMonitorService.checkSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fonte inexistente: NotFoundException', async () => {
    servir(PAGINA);
    const { service } = montar({ fonte: null });
    await expect(service.checkSource('nao-existe')).rejects.toThrow(NotFoundException);
  });

  it('versão nova: outcome nova_versao, marca ok e NÃO envia e-mail', async () => {
    servir(PAGINA);
    const { service, email, sucessos, falhas } = montar({ recorded: { id: 'd1' } });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('nova_versao');
    expect(r.message).toMatch(/Aguardando validação/);
    expect(sucessos()).toHaveLength(1);
    expect(falhas()).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sem versão criada: mensagem honesta (sem mudança relevante OU já há uma aguardando revisão)', async () => {
    servir(PAGINA);
    const { service } = montar({ recorded: null });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('sem_mudanca');
    expect(r.message).toMatch(/sem mudança relevante ou já há uma versão aguardando revisão/);
  });

  it('erro de HTTP: outcome erro, grava a falha e devolve a mensagem', async () => {
    servir('', { status: 500 });
    const { service, falhas, documents } = montar();
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/status 500/);
    expect(falhas()).toHaveLength(1);
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('extração suspeita (texto minúsculo): outcome erro com "Conteúdo suspeito"', async () => {
    servir('<html><body>curto</body></html>');
    const { service, documents } = montar({ vigenteChars: 35754 });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/Conteúdo suspeito/);
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('URL que resolve para a rede interna é bloqueada pela guarda (e conta como falha)', async () => {
    const fetchSpy = servir(PAGINA);
    const { service, falhas } = montar({ fonte: { id: 's1', code: null, title: 'X', official_url: 'https://interno.exemplo.com.br/x' } });
    const r = await service.checkSource('s1');
    expect(r.outcome).toBe('erro');
    expect(r.message).toMatch(/rede interna/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(falhas()).toHaveLength(1);
  });
});

describe('NormativeMonitorService.previewUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  it('página boa: devolve métricas e uma amostra, sem gravar nada', async () => {
    servir(PAGINA);
    const { service, documents } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/nr06.htm');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status_code).toBe(200);
      expect(r.mime_type).toBe('text/html');
      expect(r.chars).toBeGreaterThan(500);
      expect(r.meaningful_chars).toBe(r.chars);
      expect(r.sample.length).toBeLessThanOrEqual(400);
      expect(r.sample).toContain('Texto da norma');
      expect(r.suspicious).toBeNull();
    }
    expect(documents.recordDetectedVersion).not.toHaveBeenCalled();
  });

  it('página vazia: ok mas marcada como suspeita', async () => {
    servir('<html><body>curto</body></html>');
    const { service } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/vazia.htm');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.suspicious).toMatch(/Conteúdo suspeito/);
  });

  it('falha de rede/HTTP: ok false com a mensagem', async () => {
    servir('', { status: 403 });
    const { service } = montar();
    const r = await service.previewUrl('https://exemplo.gov.br/bloqueada.htm');
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/status 403/) });
  });

  it('URL interna: ok false, sem fazer nenhuma requisição', async () => {
    const fetchSpy = servir(PAGINA);
    const { service } = montar();
    const r = await service.previewUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mensagemDeErro (tradução de falhas de rede)', () => {
  const falhaDeRede = (code?: string) => Object.assign(new TypeError('fetch failed'), { cause: code ? { code } : undefined });

  it.each([
    ['ENOTFOUND', 'Domínio não encontrado (DNS)'],
    ['ECONNREFUSED', 'Conexão recusada pelo servidor'],
    ['ECONNRESET', 'Conexão interrompida pelo servidor'],
    ['ETIMEDOUT', 'Tempo esgotado ao acessar a fonte (30 s)'],
    ['UND_ERR_CONNECT_TIMEOUT', 'Tempo esgotado ao acessar a fonte (30 s)'],
    ['CERT_HAS_EXPIRED', 'Certificado HTTPS inválido na fonte'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'Certificado HTTPS inválido na fonte'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'Certificado HTTPS inválido na fonte'],
    ['EAI_AGAIN', 'Falha de rede ao acessar a fonte'],
    [undefined, 'Falha de rede ao acessar a fonte'],
  ])('fetch failed com causa %s', (code, esperado) => {
    expect(mensagemDeErro(falhaDeRede(code))).toBe(esperado);
  });

  it('AbortError/TimeoutError viram tempo esgotado', () => {
    expect(mensagemDeErro(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe(
      'Tempo esgotado ao acessar a fonte (30 s)',
    );
    expect(mensagemDeErro(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))).toBe(
      'Tempo esgotado ao acessar a fonte (30 s)',
    );
  });

  it('mantém intactas as demais mensagens', () => {
    expect(mensagemDeErro(new Error('Fonte respondeu status 403'))).toBe('Fonte respondeu status 403');
    expect(mensagemDeErro(new Error('Conteúdo suspeito: texto minúsculo'))).toBe('Conteúdo suspeito: texto minúsculo');
  });

  it('checkSource e previewUrl usam a tradução', async () => {
    jest.spyOn(global, 'fetch' as any).mockImplementation(async () => {
      throw falhaDeRede('ENOTFOUND');
    });
    const { service } = montar();
    expect(await service.checkSource('s1')).toEqual({ outcome: 'erro', message: 'Domínio não encontrado (DNS)' });
    expect(await service.previewUrl('https://exemplo.gov.br/x.htm')).toEqual({ ok: false, message: 'Domínio não encontrado (DNS)' });
  });
});
