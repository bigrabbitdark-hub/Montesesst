import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NovaEmpresaForm } from '../clientes/NovaEmpresaForm';
import { atuacaoFetch } from '../api';

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'T');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('NovaEmpresaForm', () => {
  const preencher = (senha = 'Temporaria1', cnpj = '11.222.333/0001-81') => {
    fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Empresa Exemplo' } });
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: cnpj } });
    fireEvent.change(screen.getByLabelText('Nome do responsável (RH)'), { target: { value: 'RH Exemplo' } });
    fireEvent.change(screen.getByLabelText('E-mail do RH'), { target: { value: 'rh@exemplo.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: senha } });
  };
  const enviar = () => fireEvent.click(screen.getByRole('button', { name: /cadastrar empresa/i }));

  it('mostra a senha uma única vez após criar, com aviso, e depois a esconde', async () => {
    fetchMock.mockResolvedValue(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }));
    const onCriada = vi.fn();
    render(<NovaEmpresaForm onCriada={onCriada} />);
    preencher();
    enviar();
    expect(await screen.findByText('Temporaria1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/não será exibida novamente/i);
    expect(screen.getByRole('status')).toHaveTextContent(/canal seguro/i);
    expect(screen.getByText('rh@exemplo.com.br')).toBeInTheDocument();
    expect(onCriada).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/atuacao/clientes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      company_name: 'Empresa Exemplo', cnpj: '11222333000181', full_name: 'RH Exemplo',
      email: 'rh@exemplo.com.br', password: 'Temporaria1',
    });
    // a senha não vai para title/aria-label
    expect(document.querySelector('[title="Temporaria1"],[aria-label="Temporaria1"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /concluir/i }));
    expect(screen.queryByText('Temporaria1')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Temporaria1');
  });

  it('rejeita senha curta sem chamar a API', () => {
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher('123');
    enviar();
    expect(screen.getByRole('alert')).toHaveTextContent(/8 e 72/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita CNPJ inválido sem chamar a API', () => {
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher('Temporaria1', '11.111.111/1111-11');
    enviar();
    expect(screen.getByRole('alert')).toHaveTextContent(/CNPJ/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra a mensagem do servidor em conflito (409)', async () => {
    fetchMock.mockResolvedValue(resp(409, { message: 'CNPJ ou e-mail já cadastrado.' }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/já cadastrado/i));
    expect(screen.getByLabelText('Razão social')).toHaveValue('Empresa Exemplo');
  });

  it('em 403 mostra a mensagem de permissão', async () => {
    fetchMock.mockResolvedValue(resp(403, {}));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Você não tem permissão para esta ação.'));
  });

  it('desabilita o botão durante o envio', async () => {
    let fim!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { fim = r; }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    const botao = await screen.findByRole('button', { name: /cadastrando/i });
    expect(botao).toBeDisabled();
    fim(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }));
    await screen.findByRole('status');
  });

  it('senha é type=password, new-password, e pode ser mostrada para conferência', () => {
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    const campo = screen.getByLabelText('Senha temporária');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'new-password');
    fireEvent.click(screen.getByRole('checkbox', { name: /mostrar senha/i }));
    expect(campo).toHaveAttribute('type', 'text');
  });

  it('preenche a razão social pela consulta de CNPJ existente', async () => {
    fetchMock.mockResolvedValue(resp(200, { cnpj: '11222333000181', razao_social: 'ALFA INDUSTRIA LTDA' }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-81' } });
    fireEvent.blur(screen.getByLabelText('CNPJ'));
    await waitFor(() => expect(screen.getByLabelText('Razão social')).toHaveValue('ALFA INDUSTRIA LTDA'));
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/cnpj-lookup/11222333000181');
  });

  it.each([
    ['razão social curta', () => fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'A' } }), /razão social.*entre 2 e 200/i],
    ['nome curto', () => fireEvent.change(screen.getByLabelText('Nome do responsável (RH)'), { target: { value: 'R' } }), /nome do responsável.*entre 2 e 200/i],
    ['e-mail sem domínio', () => fireEvent.change(screen.getByLabelText('E-mail do RH'), { target: { value: 'rh@empresa' } }), /e-mail válido/i],
    ['senha curta', () => fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: '123' } }), /entre 8 e 72/i],
  ])('validação em português: %s não chama a API', (_n, alterar, msg) => {
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    alterar();
    enviar();
    expect(screen.getByRole('alert')).toHaveTextContent(msg);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 do servidor (inglês) vira mensagem genérica em português', async () => {
    fetchMock.mockResolvedValue(resp(400, { message: ['email must be an email'] }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Confira os dados informados e tente novamente.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/must be/);
  });

  it('429 mostra mensagem de excesso de tentativas', async () => {
    fetchMock.mockResolvedValue(resp(429, {}));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas. Aguarde alguns minutos e tente novamente.'));
  });

  it('foca o título do sucesso', async () => {
    fetchMock.mockResolvedValue(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    const titulo = await screen.findByRole('heading', { name: 'Cadastro concluído' });
    expect(titulo).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(titulo).toHaveFocus());
  });

  it('400 em outras rotas mantém a mensagem do servidor', async () => {
    const { atuacaoFetch } = await import('../api');
    fetchMock.mockResolvedValue(resp(400, { message: ['sector must be shorter'] }));
    await expect(atuacaoFetch('/clientes/t-1', { method: 'PATCH', body: '{}' })).rejects.toThrow('sector must be shorter');
  });

  // Ruling 26: bcrypt usa só 72 BYTES; 'ç' ocupa 2 bytes em UTF-8.
  it("recusa senha com 'ç' x 72 (144 bytes) sem chamar a API, com mensagem em português", () => {
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher('ç'.repeat(72));
    enviar();
    expect(screen.getByRole('alert')).toHaveTextContent('A senha não pode passar de 72 bytes (acentos e símbolos contam mais de 1)');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aceita 36 'ç' (72 bytes)", async () => {
    fetchMock.mockResolvedValue(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher('ç'.repeat(36));
    enviar();
    await screen.findByText('Cadastro concluído');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Trava síncrona (ref): dois envios no mesmo ciclo de render (antes de o estado 'enviando' valer) => 1 POST.
  it('dois envios rápidos no mesmo ciclo disparam UMA chamada', async () => {
    let fim!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { fim = r; }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    const form = screen.getByRole('button', { name: /cadastrar empresa/i }).closest('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { fim(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' })); });
    await screen.findByText('Cadastro concluído');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('depois de um erro, permite reenviar (a trava é liberada)', async () => {
    fetchMock.mockResolvedValueOnce(resp(403, {}));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await screen.findByRole('alert');
    fetchMock.mockResolvedValueOnce(resp(201, { tenant_id: 't', user_id: 'u', email: 'rh@exemplo.com.br' }));
    enviar();
    await screen.findByText('Cadastro concluído');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // F5: o 23505 do servidor vira "Registro duplicado"; no cadastro a mensagem amigável tem prioridade.
  it('409 no POST /clientes mostra "CNPJ ou e-mail já cadastrado." mesmo se o servidor disser "Registro duplicado"', async () => {
    fetchMock.mockResolvedValue(resp(409, { message: 'Registro duplicado' }));
    render(<NovaEmpresaForm onCriada={vi.fn()} />);
    preencher();
    enviar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('CNPJ ou e-mail já cadastrado.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Registro duplicado/);
  });
  it('409 em /clientes com outro método NÃO usa a mensagem do cadastro', async () => {
    fetchMock.mockResolvedValue(resp(409, { message: 'Registro duplicado' }));
    await expect(atuacaoFetch('/clientes')).rejects.toThrow();
    await expect(atuacaoFetch('/clientes')).rejects.not.toThrow('CNPJ ou e-mail já cadastrado.');
  });
});
