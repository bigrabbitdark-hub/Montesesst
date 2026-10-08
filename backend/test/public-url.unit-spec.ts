import {
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublic,
  isPublicIp,
  readBodyCapped,
} from '../src/common/url/public-url.util';

const publico = async () => [{ address: '200.10.10.10', family: 4 }];

describe('isPublicIp', () => {
  it.each([
    '8.8.8.8',
    '200.10.10.10',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s é público', (ip) => expect(isPublicIp(ip)).toBe(true));

  it.each([
    '0.0.0.0',
    '10.0.0.5',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.2.10',
    '198.18.0.1',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::1',
    '2001:db8::1',
    'não é ip',
  ])('%s NÃO é público', (ip) => expect(isPublicIp(ip)).toBe(false));

  it('limites das faixas privadas de 172 e 100', () => {
    expect(isPublicIp('172.15.0.1')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true);
    expect(isPublicIp('100.63.0.1')).toBe(true);
    expect(isPublicIp('100.128.0.1')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('aceita uma URL https pública (DNS devolve IP público)', async () => {
    const url = await assertPublicUrl('https://www.planalto.gov.br/ccivil_03/leis/l8213cons.htm', publico);
    expect(url.hostname).toBe('www.planalto.gov.br');
  });

  it.each([
    ['ftp://exemplo.gov.br/x', /http/],
    ['file:///etc/passwd', /http/],
    ['http://user:senha@exemplo.gov.br/', /usuário e senha/],
    ['https://exemplo.gov.br:8443/x', /portas 80 e 443/],
    ['http://localhost/x', /interno/],
    ['http://backend:4000/health', /interno/],
    ['http://montese_postgres:5432/', /interno/],
    ['http://meu-servidor.local/x', /interno/],
    ['http://servico.internal/x', /interno/],
    ['http://127.0.0.1/x', /não público/],
    ['http://127.1/x', /não público/],
    ['http://2130706433/x', /não público/],
    ['http://0x7f000001/x', /não público/],
    ['http://10.0.0.5/x', /não público/],
    ['http://169.254.169.254/latest/meta-data/', /não público/],
    ['http://[::1]/x', /não público/],
    ['http://[::ffff:127.0.0.1]/x', /não público/],
    ['não é url', /inválida/],
  ])('bloqueia %s', async (raw, mensagem) => {
    await expect(assertPublicUrl(raw, publico)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl(raw, publico)).rejects.toThrow(mensagem);
  });

  it('bloqueia host cujo DNS resolve para a rede interna', async () => {
    const interno = async () => [{ address: '10.1.2.3', family: 4 }];
    await expect(assertPublicUrl('https://parece-publico.exemplo.com.br/', interno)).rejects.toThrow(/rede interna/);
  });

  it('bloqueia se QUALQUER endereço resolvido for não público', async () => {
    const misto = async () => [
      { address: '200.10.10.10', family: 4 },
      { address: '192.168.0.9', family: 4 },
    ];
    await expect(assertPublicUrl('https://misto.exemplo.com.br/', misto)).rejects.toThrow(/rede interna/);
  });

  it('se o DNS falhar, deixa passar (a conexão também falharia)', async () => {
    const falha = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicUrl('https://nao-existe.exemplo.com.br/', falha)).resolves.toBeInstanceOf(URL);
  });
});

describe('fetchPublic', () => {
  const resposta = (status: number, headers: Record<string, string> = {}, corpo = 'ok') =>
    new Response(corpo, { status, headers });

  it('pede redirect: manual e devolve a resposta final', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => resposta(200));
    const { response, finalUrl } = await fetchPublic('https://exemplo.gov.br/a', { headers: { 'X-Teste': '1' } }, { lookup: publico, fetchImpl });
    expect(response.status).toBe(200);
    expect(finalUrl).toBe('https://exemplo.gov.br/a');
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.redirect).toBe('manual');
    expect(init.headers['X-Teste']).toBe('1');
  });

  it('segue redirecionamento para destino público, resolvendo URL relativa', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta(302, { location: '/novo/caminho' }))
      .mockResolvedValueOnce(resposta(200));
    const { finalUrl } = await fetchPublic('https://exemplo.gov.br/velho', {}, { lookup: publico, fetchImpl });
    expect(finalUrl).toBe('https://exemplo.gov.br/novo/caminho');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('BLOQUEIA redirecionamento para a rede interna (revalida cada salto)', async () => {
    const fetchImpl = jest.fn(async () => resposta(302, { location: 'http://169.254.169.254/latest/meta-data/' }));
    await expect(fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl })).rejects.toThrow(/não público/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('para depois de 5 redirecionamentos', async () => {
    const fetchImpl = jest.fn(async () => resposta(301, { location: 'https://exemplo.gov.br/de-novo' }));
    await expect(fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl })).rejects.toThrow(/Redirecionamentos demais/);
  });

  it('3xx sem Location é devolvido como resposta final', async () => {
    const fetchImpl = jest.fn(async () => resposta(300));
    const { response } = await fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico, fetchImpl });
    expect(response.status).toBe(300);
  });
});

describe('readBodyCapped', () => {
  it('lê o corpo inteiro quando cabe no limite', async () => {
    const buf = await readBodyCapped(new Response('olá mundo'), 1024);
    expect(buf.toString('utf8')).toBe('olá mundo');
  });

  it('recusa pelo Content-Length declarado', async () => {
    const r = new Response('x', { headers: { 'content-length': '5000' } });
    await expect(readBodyCapped(r, 1000)).rejects.toThrow(/maior que o limite/);
  });

  it('recusa quando o corpo real passa do limite (sem Content-Length)', async () => {
    await expect(readBodyCapped(new Response('a'.repeat(2000)), 1000)).rejects.toThrow(/maior que o limite/);
  });
});

describe('fix round 1', () => {
  const publico2 = async () => [{ address: '200.10.10.10', family: 4 }];

  it.each(['fec0::1', '2002::1', '2002:7f00:1::1', '::7f00:1', '::127.0.0.1', '::ffff:0:7f00:1', '100::1'])(
    '%s NÃO é público',
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );

  it.each(['http://localhost./x', 'http://backend./x', 'http://foo.local./x', 'http://servico.internal../x'])(
    'host com ponto final %s é interno',
    async (raw) => {
      await expect(assertPublicUrl(raw, publico2)).rejects.toThrow(/interno/);
    },
  );

  it('Location malformado vira UnsafeUrlError', async () => {
    const fetchImpl = jest.fn(async (_u: string, _i?: RequestInit) =>
      new Response('x', { status: 302, headers: { location: 'http://[' } }),
    );
    const p = fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico2, fetchImpl });
    await expect(p).rejects.toThrow(UnsafeUrlError);
    await expect(
      fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico2, fetchImpl }),
    ).rejects.toThrow(/Redirecionamento inválido/);
  });

  it('cancela o body do salto 3xx', async () => {
    const cancel = jest.fn();
    const corpo = new ReadableStream({ cancel });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response(corpo, { status: 302, headers: { location: '/b' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await fetchPublic('https://exemplo.gov.br/a', {}, { lookup: publico2, fetchImpl });
    expect(cancel).toHaveBeenCalled();
  });

  it('cancela o body ao recusar por Content-Length', async () => {
    const cancel = jest.fn();
    const corpo = new ReadableStream({ cancel });
    const r = new Response(corpo, { headers: { 'content-length': '5000' } });
    await expect(readBodyCapped(r, 1000)).rejects.toThrow(/maior que o limite/);
    expect(cancel).toHaveBeenCalled();
  });

  it('cancela o reader quando o limite estoura no meio da leitura', async () => {
    const cancel = jest.fn();
    const corpo = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(600));
      },
      cancel,
    });
    await expect(readBodyCapped(new Response(corpo), 1000)).rejects.toThrow(/maior que o limite/);
    expect(cancel).toHaveBeenCalled();
  });

  it('cancela o reader quando read() lança', async () => {
    const cancel = jest.fn();
    const corpo = new ReadableStream({
      pull() {
        throw new Error('falha de rede');
      },
      cancel,
    });
    await expect(readBodyCapped(new Response(corpo), 1000)).rejects.toThrow(/falha de rede/);
  });
});
