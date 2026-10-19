import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

import { FiliaisForm, CompanyUnit } from '../FiliaisForm';

const resposta = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const CNPJ = '12.345.678/0002-76';
const DADOS = {
  cnpj: '12345678000276',
  razao_social: 'FILIAL SA',
  address_street: 'RUA DAS FLORES',
  address_number: '123',
  address_complement: 'SALA 4',
  address_neighborhood: 'CENTRO',
  address_city: 'SAO PAULO',
  address_state: 'SP',
  address_zip: '01310100',
  cnae_code: '4120400',
  cnae_description: 'Construção de edifícios',
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const novo = () => within(screen.getByRole('form', { name: 'Nova filial' }));
const campo = (r: RegExp, scope = novo()) => scope.getByLabelText(r) as HTMLInputElement;
const unit = (over: Partial<CompanyUnit> = {}): CompanyUnit => ({
  id: 'u1', name: 'Filial Antiga', cnpj: null, address_street: 'Rua Velha', address_number: null,
  address_city: 'Rio', address_state: 'RJ', address_zip: '20000000', is_matriz: false, ...over,
});

function preencheObrigatorios(scope = novo()) {
  for (const [r, v] of [[/Nome da filial/, 'F'], [/CNPJ da filial/, CNPJ], [/^Rua/, 'R'], [/^Cidade/, 'C'], [/^UF/, 'SC'], [/^CEP/, '88801000']] as const) {
    fireEvent.change(campo(r, scope), { target: { value: v } });
  }
}

describe('FiliaisForm — cadastro com CNPJ', () => {
  it('CNPJ da filial é obrigatório e não existe "Nome fantasia"', () => {
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    expect(campo(/CNPJ da filial/).required).toBe(true);
    expect(screen.queryByText(/Nome fantasia/i)).not.toBeInTheDocument();
    expect(campo(/Observação/)).toBeInTheDocument();
  });

  it('ao sair do CNPJ preenche razão social, endereço e CNAE só nos campos vazios; nome da filial intacto', async () => {
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    fireEvent.change(campo(/Nome da filial/), { target: { value: 'Sede Sul' } });
    fireEvent.change(campo(/^Cidade/), { target: { value: 'Digitada' } });
    fireEvent.change(campo(/CNPJ da filial/), { target: { value: CNPJ } });
    fireEvent.blur(campo(/CNPJ da filial/));
    await waitFor(() => expect(campo(/^Rua/).value).toBe('RUA DAS FLORES'));
    expect(campo(/Razão social/).value).toBe('FILIAL SA');
    expect(campo(/^Bairro/).value).toBe('CENTRO');
    expect(campo(/^Complemento/).value).toBe('SALA 4');
    expect(campo(/^CNAE principal/).value).toBe('4120400');
    expect(campo(/^Descrição do CNAE/).value).toBe('Construção de edifícios');
    expect(campo(/^UF/).value).toBe('SP');
    expect(campo(/^Cidade/).value).toBe('Digitada');
    expect(campo(/Nome da filial/).value).toBe('Sede Sul');
  });

  it('fonte indisponível: mensagem e preenchimento manual continua', async () => {
    fetchMock.mockResolvedValue(resposta(503));
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    fireEvent.change(campo(/CNPJ da filial/), { target: { value: CNPJ } });
    fireEvent.blur(campo(/CNPJ da filial/));
    expect(await screen.findByText(/Não foi possível consultar o CNPJ agora/)).toBeInTheDocument();
    fireEvent.change(campo(/^Rua/), { target: { value: 'Manual' } });
    expect(campo(/^Rua/).value).toBe('Manual');
  });

  it('dados incompletos da fonte: preenche só o que veio', async () => {
    fetchMock.mockResolvedValue(resposta(200, { ...DADOS, razao_social: null, cnae_code: null, cnae_description: null, address_complement: null }));
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    fireEvent.change(campo(/CNPJ da filial/), { target: { value: CNPJ } });
    fireEvent.blur(campo(/CNPJ da filial/));
    await waitFor(() => expect(campo(/^Cidade/).value).toBe('SAO PAULO'));
    expect(campo(/Razão social/).value).toBe('');
    expect(campo(/^CNAE principal/).value).toBe('');
  });

  it('CNPJ inválido não envia o formulário', async () => {
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    fireEvent.change(campo(/CNPJ da filial/), { target: { value: '12.345.678/0002-77' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nova filial' }));
    expect(await screen.findByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('salva enviando CNPJ só com dígitos, a observação e os dados cadastrais', async () => {
    fetchMock.mockResolvedValue(resposta(201, {}));
    const onChanged = vi.fn();
    render(<FiliaisForm units={[]} onChanged={onChanged} />);
    preencheObrigatorios();
    fireEvent.change(campo(/Observação/), { target: { value: 'Galpão 2' } });
    fireEvent.change(campo(/Razão social/), { target: { value: 'FILIAL SA' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nova filial' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/company-units');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ cnpj: '12345678000276', notes: 'Galpão 2', legal_name: 'FILIAL SA' });
    expect(body).not.toHaveProperty('cnae_code'); // vazio no cadastro novo não é enviado
  });

  it('erro do servidor (ex.: CNPJ repetido) aparece com a mensagem dele', async () => {
    fetchMock.mockResolvedValue(resposta(409, { message: 'Já existe uma filial com este CNPJ nesta empresa.' }));
    render(<FiliaisForm units={[]} onChanged={vi.fn()} />);
    preencheObrigatorios();
    fireEvent.submit(screen.getByRole('form', { name: 'Nova filial' }));
    expect(await screen.findByText(/Já existe uma filial com este CNPJ/)).toBeInTheDocument();
  });
});

describe('FiliaisForm — lista e edição', () => {
  it('lista mostra CNPJ formatado, razão social, CNAE e observação; sem CNPJ oferece "Adicionar CNPJ"', () => {
    render(
      <FiliaisForm
        units={[unit({ id: 'a', name: 'Com CNPJ', cnpj: '12345678000276', legal_name: 'FILIAL SA', cnae_code: '4120400', notes: 'Galpão 2' }), unit()]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/CNPJ 12\.345\.678\/0002-76/)).toBeInTheDocument();
    expect(screen.getByText(/\(FILIAL SA\)/)).toBeInTheDocument();
    expect(screen.getByText(/CNAE 4120400/)).toBeInTheDocument();
    expect(screen.getByText(/Obs\.: Galpão 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar CNPJ' })).toBeInTheDocument();
  });

  it('editar: abre com os dados salvos, persiste a observação por PATCH e permite limpar', async () => {
    fetchMock.mockResolvedValue(resposta(200, {}));
    const onChanged = vi.fn();
    render(<FiliaisForm units={[unit({ cnpj: '12345678000276', notes: 'Antiga' })]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const form = within(screen.getByRole('form', { name: 'Editar filial Filial Antiga' }));
    expect(campo(/Observação/, form).value).toBe('Antiga');
    expect(campo(/CNPJ da filial/, form).value).toBe('12.345.678/0002-76');
    fireEvent.change(campo(/Observação/, form), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Editar filial Filial Antiga' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/company-units/u1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string).notes).toBe('');
  });

  it('completar filial antiga: consulta preenche só o que falta e não sobrescreve o que já existe', async () => {
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    render(<FiliaisForm units={[unit()]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar CNPJ' }));
    const form = within(screen.getByRole('form', { name: 'Editar filial Filial Antiga' }));
    fireEvent.change(campo(/CNPJ da filial/, form), { target: { value: CNPJ } });
    fireEvent.blur(campo(/CNPJ da filial/, form));
    await waitFor(() => expect(campo(/Razão social/, form).value).toBe('FILIAL SA'));
    expect(campo(/^Rua/, form).value).toBe('Rua Velha');
    expect(campo(/^Cidade/, form).value).toBe('Rio');
    expect(campo(/^CNAE principal/, form).value).toBe('4120400');
  });

  it('cancelar a edição não chama a API', () => {
    render(<FiliaisForm units={[unit()]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar CNPJ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: /Editar filial/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CNPJ inválido na edição não chama a API', async () => {
    render(<FiliaisForm units={[unit()]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar CNPJ' }));
    fireEvent.change(campo(/CNPJ da filial/, within(screen.getByRole('form', { name: 'Editar filial Filial Antiga' }))), { target: { value: '123' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Editar filial Filial Antiga' }));
    expect(await screen.findByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
