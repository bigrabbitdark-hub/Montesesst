import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { MatrizForm, TenantData } from '../MatrizForm';

const base: TenantData = {
  id: 't1',
  has_logo: false,
  name: 'EMPRESA EXEMPLO LTDA',
  cnpj: '11222333000181',
  sector: null,
  contact_name: null,
  contact_phone: null,
  trade_name: null,
  contact_role: null,
  address_street: null,
  address_number: null,
  address_city: null,
  address_state: null,
  address_zip: null,
};

const DADOS = {
  cnpj: base.cnpj,
  razao_social: base.name,
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

const resposta = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const campo = (rotulo: RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderiza(tenant: TenantData = base) {
  return render(<MatrizForm tenant={tenant} onSaved={vi.fn()} onLogoChanged={vi.fn()} />);
}

describe('MatrizForm — CNPJ e Observação', () => {
  it('matriz vazia: consulta automaticamente e preenche endereço e CNAE', async () => {
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    renderiza();
    await waitFor(() => expect(campo(/^Rua/).value).toBe('RUA DAS FLORES'));
    expect(campo(/^Cidade/).value).toBe('SAO PAULO');
    expect(campo(/^UF/).value).toBe('SP');
    expect(campo(/^CEP/).value).toBe('01310100');
    expect(campo(/^Bairro/).value).toBe('CENTRO');
    expect(campo(/^CNAE principal/).value).toBe('4120400');
    expect(campo(/^Descrição do CNAE/).value).toBe('Construção de edifícios');
  });

  it('usa o CNPJ da própria empresa e não faz consulta se a matriz já tem endereço', () => {
    renderiza({ ...base, address_street: 'Rua Salva', address_city: 'Rio', address_zip: '20000000' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('botão manual não sobrescreve campo já preenchido e permite corrigir', async () => {
    renderiza({ ...base, address_street: 'Rua Salva' });
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    fireEvent.click(screen.getByRole('button', { name: /Preencher dados pelo CNPJ/ }));
    await waitFor(() => expect(campo(/^Cidade/).value).toBe('SAO PAULO'));
    expect(campo(/^Rua/).value).toBe('Rua Salva');
    fireEvent.change(campo(/^Cidade/), { target: { value: 'Campinas' } });
    expect(campo(/^Cidade/).value).toBe('Campinas');
  });

  it('fonte indisponível: mostra mensagem e o formulário segue editável', async () => {
    fetchMock.mockResolvedValue(resposta(503));
    renderiza();
    expect(await screen.findByText(/Não foi possível consultar o CNPJ agora/)).toBeInTheDocument();
    fireEvent.change(campo(/^Rua/), { target: { value: 'Manual' } });
    expect(campo(/^Rua/).value).toBe('Manual');
  });

  it('dados incompletos da fonte: preenche só o que veio', async () => {
    fetchMock.mockResolvedValue(resposta(200, { ...DADOS, address_street: null, cnae_code: null, cnae_description: null }));
    renderiza();
    await waitFor(() => expect(campo(/^Cidade/).value).toBe('SAO PAULO'));
    expect(campo(/^Rua/).value).toBe('');
    expect(campo(/^CNAE principal/).value).toBe('');
  });

  it('"Nome fantasia" não existe mais; "Observação" existe e carrega o valor salvo', () => {
    renderiza({ ...base, notes: 'Obra com 3 turnos', address_street: 'x' });
    expect(screen.queryByText(/Nome fantasia/i)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/Observação/) as HTMLTextAreaElement).value).toBe('Obra com 3 turnos');
  });

  it('salvar envia a observação (e não envia trade_name, que fica intacto no banco)', async () => {
    renderiza({ ...base, trade_name: 'Fantasia Antiga', address_street: 'Rua', address_city: 'Rio', address_state: 'RJ', address_zip: '20000000', contact_name: 'Ana', contact_role: 'RH' });
    fetchMock.mockResolvedValue(resposta(200, {}));
    fireEvent.change(screen.getByLabelText(/Observação/), { target: { value: 'Nova observação' } });
    fireEvent.submit(screen.getByRole('button', { name: /Salvar e continuar/ }).closest('form')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tenants/me');
    const body = JSON.parse(init.body as string);
    expect(body.notes).toBe('Nova observação');
    expect(body).not.toHaveProperty('trade_name');
  });

  it('compatibilidade: empresa antiga sem os campos novos abre sem erro', () => {
    const { notes, address_neighborhood, address_complement, cnae_code, cnae_description, ...antiga } = base as any;
    fetchMock.mockResolvedValue(resposta(404));
    expect(() => renderiza(antiga)).not.toThrow();
    expect((screen.getByLabelText(/Observação/) as HTMLTextAreaElement).value).toBe('');
  });
});
