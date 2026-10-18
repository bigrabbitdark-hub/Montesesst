import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/components/AuthSplit', () => ({ AuthSplit: ({ children }: any) => <div>{children}</div> }));

import CadastroPage from '../page';

const CNPJ_OK = '11.222.333/0001-81';
const DADOS = { cnpj: '11222333000181', razao_social: 'EMPRESA EXEMPLO LTDA' };

function resposta(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const campoCnpj = () => screen.getByLabelText(/CNPJ/) as HTMLInputElement;
const campoNome = () => screen.getByLabelText(/Nome da empresa/) as HTMLInputElement;

function digitaCnpj(valor: string) {
  fireEvent.change(campoCnpj(), { target: { value: valor } });
  fireEvent.blur(campoCnpj());
}

describe('cadastro — preenchimento pelo CNPJ', () => {
  it('CNPJ válido: consulta ao sair do campo e preenche a razão social', async () => {
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    render(<CadastroPage />);
    digitaCnpj(CNPJ_OK);
    await waitFor(() => expect(campoNome().value).toBe('EMPRESA EXEMPLO LTDA'));
    expect(fetchMock).toHaveBeenCalledWith('/api/cnpj-lookup/11222333000181', expect.anything());
  });

  it('CNPJ inválido: mostra mensagem e não chama a API', async () => {
    render(<CadastroPage />);
    digitaCnpj('11.222.333/0001-82');
    expect(await screen.findByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empresa não encontrada: mensagem clara e preenchimento manual continua possível', async () => {
    fetchMock.mockResolvedValue(resposta(404));
    render(<CadastroPage />);
    digitaCnpj(CNPJ_OK);
    expect(await screen.findByText(/Empresa não encontrada/)).toBeInTheDocument();
    fireEvent.change(campoNome(), { target: { value: 'Digitada à mão' } });
    expect(campoNome().value).toBe('Digitada à mão');
  });

  it('limite de consultas (429) e fonte indisponível (503/rede) têm mensagens próprias', async () => {
    fetchMock.mockResolvedValueOnce(resposta(429));
    render(<CadastroPage />);
    digitaCnpj(CNPJ_OK);
    expect(await screen.findByText(/Limite de consultas/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(resposta(503));
    digitaCnpj('11222333000181');
    expect(await screen.findByText(/Não foi possível consultar o CNPJ agora/)).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error('rede'));
    digitaCnpj(CNPJ_OK);
    expect(await screen.findByText(/Não foi possível consultar o CNPJ agora/)).toBeInTheDocument();
    expect(campoNome().disabled).toBe(false);
  });

  it('não sobrescreve a razão social que o usuário já digitou', async () => {
    fetchMock.mockResolvedValue(resposta(200, DADOS));
    render(<CadastroPage />);
    fireEvent.change(campoNome(), { target: { value: 'Minha digitação' } });
    digitaCnpj(CNPJ_OK);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Consultando CNPJ/)).not.toBeInTheDocument());
    expect(campoNome().value).toBe('Minha digitação');
  });

  it('resposta fora de ordem: só a consulta mais recente é aplicada', async () => {
    let liberaPrimeira!: (v: unknown) => void;
    const primeira = new Promise((r) => (liberaPrimeira = r));
    fetchMock
      .mockImplementationOnce(() => primeira)
      .mockResolvedValueOnce(resposta(200, { cnpj: '2', razao_social: 'SEGUNDA LTDA' }));
    render(<CadastroPage />);
    digitaCnpj(CNPJ_OK); // lenta
    digitaCnpj('45.723.174/0001-10'); // rápida, mais recente
    await waitFor(() => expect(campoNome().value).toBe('SEGUNDA LTDA'));
    liberaPrimeira(resposta(200, { cnpj: '1', razao_social: 'PRIMEIRA LTDA' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(campoNome().value).toBe('SEGUNDA LTDA');
  });

  it('dados incompletos: razão social ausente não apaga nem inventa nada', async () => {
    fetchMock.mockResolvedValue(resposta(200, { cnpj: '1', razao_social: null }));
    render(<CadastroPage />);
    digitaCnpj(CNPJ_OK);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(campoNome().value).toBe('');
  });
});
