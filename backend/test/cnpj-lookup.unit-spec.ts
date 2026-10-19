import { CnpjLookupService, normalizeBrasilApiPayload } from '../src/cnpj-lookup/cnpj-lookup.service';

const CNPJ = '11222333000181'; // dígito verificador válido (ver cnpj.util.ts)

const payloadCompleto = {
  razao_social: '  EMPRESA   EXEMPLO LTDA ',
  descricao_situacao_cadastral: 'ATIVA',
  logradouro: 'RUA DAS FLORES',
  numero: '123',
  complemento: 'SALA 4',
  bairro: 'CENTRO',
  municipio: 'SAO PAULO',
  uf: 'sp',
  cep: '01310100',
  cnae_fiscal: 4120400,
  cnae_fiscal_descricao: 'Construção de edifícios',
};

function mockFetch(status: number, body?: unknown) {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('sem corpo');
      return body;
    },
  }));
  (global as any).fetch = fn;
  return fn;
}

describe('CnpjLookupService', () => {
  const originalFetch = (global as any).fetch;
  let service: CnpjLookupService;

  beforeEach(() => {
    service = new CnpjLookupService();
  });
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('consulta com CNPJ válido (com máscara) e preenche razão social e endereço', async () => {
    const fetchMock = mockFetch(200, payloadCompleto);
    const result = await service.lookup('11.222.333/0001-81');
    expect((fetchMock.mock.calls[0] as any)[0]).toContain(`/cnpj/v1/${CNPJ}`);
    expect(result).toMatchObject({
      cnpj: CNPJ,
      razao_social: 'EMPRESA EXEMPLO LTDA',
      address_street: 'RUA DAS FLORES',
      address_number: '123',
      address_complement: 'SALA 4',
      address_neighborhood: 'CENTRO',
      address_city: 'SAO PAULO',
      address_state: 'SP',
      address_zip: '01310100',
    });
  });

  it('preenche o CNAE principal quando disponível', async () => {
    mockFetch(200, payloadCompleto);
    const result = await service.lookup(CNPJ);
    expect(result.cnae_code).toBe('4120400');
    expect(result.cnae_description).toBe('Construção de edifícios');
  });

  it('rejeita CNPJ inválido sem chamar a fonte externa', async () => {
    const fetchMock = mockFetch(200, payloadCompleto);
    await expect(service.lookup('11.222.333/0001-82')).rejects.toMatchObject({ status: 400 });
    await expect(service.lookup('123')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empresa não encontrada → 404', async () => {
    mockFetch(404, { message: 'CNPJ não encontrado' });
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 404 });
  });

  it('limite da fonte → 429', async () => {
    mockFetch(429, {});
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 429 });
  });

  it('fonte indisponível (HTTP 500 ou falha de rede) → 503', async () => {
    mockFetch(500, {});
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 503 });
    (global as any).fetch = jest.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 503 });
  });

  it('dados incompletos: campos ausentes ou de tipo errado viram null, sem inventar valor', async () => {
    mockFetch(200, { razao_social: 'SO RAZAO LTDA', uf: 'XYZ', cep: '123', cnae_fiscal: 'abc', numero: 42 });
    const result = await service.lookup(CNPJ);
    expect(result.razao_social).toBe('SO RAZAO LTDA');
    expect(result).toMatchObject({
      address_street: null,
      address_number: null,
      address_state: null,
      address_zip: null,
      cnae_code: null,
      cnae_description: null,
    });
  });

  it('resposta que não é objeto → 503', async () => {
    mockFetch(200, ['x']);
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 503 });
    expect(() => normalizeBrasilApiPayload(CNPJ, null)).toThrow();
  });

  it('limita o tamanho dos campos ao que o UpdateTenantDto aceita', () => {
    const r = normalizeBrasilApiPayload(CNPJ, { logradouro: 'A'.repeat(500), municipio: 'B'.repeat(500) });
    expect(r.address_street).toHaveLength(200);
    expect(r.address_city).toHaveLength(100);
  });

  it('usa cache: segunda consulta do mesmo CNPJ não chama a fonte de novo', async () => {
    const fetchMock = mockFetch(200, payloadCompleto);
    await service.lookup(CNPJ);
    await service.lookup('11.222.333/0001-81');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não grava falha no cache: depois de 503 a próxima consulta tenta de novo', async () => {
    mockFetch(500, {});
    await expect(service.lookup(CNPJ)).rejects.toMatchObject({ status: 503 });
    const fetchMock = mockFetch(200, payloadCompleto);
    await expect(service.lookup(CNPJ)).resolves.toMatchObject({ cnpj: CNPJ });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
