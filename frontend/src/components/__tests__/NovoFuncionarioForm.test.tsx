import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NovoFuncionarioForm } from '../NovoFuncionarioForm';
import { sessionExpired } from '@/lib/auth';

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), sessionExpired: vi.fn() }));

const UNITS = [{ id: 'u1', name: 'Matriz SP' }, { id: 'u2', name: 'Filial RJ' }];

function resp(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

function posts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
}

// Rótulos como 'Matrícula (eSocial)' têm parênteses: escapa antes de montar a RegExp.
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rotulo = (label: string) => new RegExp('^' + escapar(label));

function digitar(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(rotulo(label)), { target: { value } });
}

function abrir(onCreated = vi.fn(), tenantId?: string) {
  render(<NovoFuncionarioForm units={UNITS} onCreated={onCreated} tenantId={tenantId} />);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar funcionário' }));
  return onCreated;
}

describe('NovoFuncionarioForm', () => {
  beforeEach(() => localStorage.setItem('montese_token', 'test-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('começa fechado e abre com os campos do modelo, sem anexar documento', () => {
    render(<NovoFuncionarioForm units={UNITS} onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/^CPF/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar funcionário' }));
    for (const l of ['Funcionário', 'CPF', 'Matrícula (eSocial)', 'Data de nascimento', 'Sexo', 'Função/Cargo', 'Data de admissão', 'CBO', 'Descrição da atividade', 'Filial']) {
      expect(screen.getByLabelText(rotulo(l))).toBeTruthy();
    }
    expect(screen.queryByText(/Anexar documento/)).toBeNull();
    expect(screen.getByRole('option', { name: 'Filial RJ' })).toBeTruthy();
  });

  it('bloqueia nome e CPF vazios sem nenhum POST', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    expect(screen.getByText('Nome é obrigatório')).toBeTruthy();
    expect(screen.getByText('CPF inválido')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bloqueia data inválida com mensagem no campo e sem POST', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    abrir();
    digitar('Funcionário', 'Ana Teste');
    digitar('CPF', '529.982.247-25');
    digitar('Data de nascimento', '31/02/1990');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    expect(screen.getByText('Data inválida. Use DD/MM/AAAA.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia o corpo exato: datas ISO, vazios omitidos, textos como digitados', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ id: 'novo' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = abrir();
    digitar('Funcionário', 'Ana Teste');
    digitar('CPF', '529.982.247-25');
    digitar('Matrícula (eSocial)', '00012345678');
    digitar('Data de nascimento', '03/02/1990');
    fireEvent.change(screen.getByLabelText(/^Sexo/), { target: { value: 'F' } });
    digitar('CBO', '051210');
    fireEvent.change(screen.getByLabelText(/^Filial/), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    await screen.findByText('Funcionário cadastrado');
    expect(posts(fetchMock)).toHaveLength(1);
    const [url, init] = posts(fetchMock)[0];
    expect(url).toBe('/api/employees');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      full_name: 'Ana Teste',
      cpf: '52998224725',
      registration_number: '00012345678',
      birth_date: '1990-02-03',
      sex: 'F',
      cbo_code: '051210',
      company_unit_id: 'u2',
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/^CPF/)).toBeNull();
  });

  it('inclui tenant_id no corpo quando informado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({}, 201));
    vi.stubGlobal('fetch', fetchMock);
    abrir(vi.fn(), 't9');
    digitar('Funcionário', 'Ana');
    digitar('CPF', '52998224725');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    await screen.findByText('Funcionário cadastrado');
    expect(JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string)).toEqual({
      full_name: 'Ana', cpf: '52998224725', tenant_id: 't9',
    });
  });

  it('401 no cadastro chama sessionExpired e não mostra "Unauthorized"', async () => {
    vi.mocked(sessionExpired).mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ message: 'Unauthorized' }, 401)));
    const onCreated = abrir();
    digitar('Funcionário', 'Ana Teste');
    digitar('CPF', '52998224725');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    await waitFor(() => expect(sessionExpired).toHaveBeenCalled());
    expect(document.body.textContent).not.toContain('Unauthorized');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'Registro duplicado'],
    [403, 'Limite de 10 funcionários do plano atingido.'],
    [400, 'CPF inválido'],
  ])('mantém o formulário e mostra o alerta no erro %i', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ message }, status));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = abrir();
    digitar('Funcionário', 'Ana Teste');
    digitar('CPF', '52998224725');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain(message);
    expect((screen.getByLabelText(/^Funcionário/) as HTMLInputElement).value).toBe('Ana Teste');
    expect((screen.getByLabelText(/^CPF/) as HTMLInputElement).value).toBe('52998224725');
    expect(screen.queryByText('Funcionário cadastrado')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('duplo clique envia um único POST e desabilita o botão', async () => {
    let resolver: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((r) => { resolver = r; }));
    vi.stubGlobal('fetch', fetchMock);
    abrir();
    digitar('Funcionário', 'Ana Teste');
    digitar('CPF', '52998224725');
    const botao = screen.getByRole('button', { name: 'Cadastrar funcionário' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(posts(fetchMock)).toHaveLength(1);
    expect((screen.getByRole('button', { name: /Cadastrando/ }) as HTMLButtonElement).disabled).toBe(true);
    resolver(resp({}, 201));
    await waitFor(() => expect(screen.getByText('Funcionário cadastrado')).toBeTruthy());
    expect(posts(fetchMock)).toHaveLength(1);
  });
});
