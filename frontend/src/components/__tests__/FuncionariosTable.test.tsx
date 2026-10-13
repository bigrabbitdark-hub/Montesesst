import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FuncionariosTable } from '../FuncionariosTable';

const COLUNAS = [
  'Qtde', 'Funcionário', 'Matrícula eSocial', 'CPF', 'Data de nascimento', 'Sexo',
  'Função/Cargo', 'Data de admissão', 'CBO', 'Descrição da atividade',
];

function linha(over: Record<string, unknown> = {}) {
  return {
    id: 'e1', sequence: 7, row_version: '3', full_name: 'Ana Teste', esocial_registration: '00012345678',
    cpf: '52998224725', birth_date: '1990-02-03', sex: 'F', position: 'Soldadora', admission_date: '2020-01-05',
    cbo_code: '051210', activity_description: null, company_unit_id: null, status: 'active', ...over,
  };
}

function resp(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

function chamadas(fetchMock: ReturnType<typeof vi.fn>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method);
}

async function abrir(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(<FuncionariosTable />);
  await screen.findByDisplayValue('Ana Teste');
}

describe('FuncionariosTable', () => {
  beforeEach(() => localStorage.setItem('montese_token', 'test-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('carrega o GET, mostra as 10 colunas e Qtde vem de sequence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ items: [linha()], total: 1 }));
    await abrir(fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/employees/table?limit=50&offset=0');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(COLUNAS);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByDisplayValue('529.982.247-25')).toBeTruthy();
    expect(screen.getByDisplayValue('03/02/1990')).toBeTruthy();
  });

  it('preserva zeros à esquerda de matrícula e CBO', async () => {
    await abrir(vi.fn().mockResolvedValue(resp({ items: [linha()], total: 1 })));
    expect(screen.getByDisplayValue('00012345678')).toBeTruthy();
    expect(screen.getByDisplayValue('051210')).toBeTruthy();
  });

  it('usa tenant_id quando informado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FuncionariosTable tenantId="t-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/employees/table?limit=50&offset=0&tenant_id=t-1');
  });

  it('Editar tabela habilita inputs; sem alterações Confirmar fica desabilitado', async () => {
    await abrir(vi.fn().mockResolvedValue(resp({ items: [linha()], total: 1 })));
    expect((screen.getByLabelText('Função/Cargo Ana Teste') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    expect((screen.getByLabelText('Função/Cargo Ana Teste') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Confirmar alterações' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('envia só o diff, só mostra sucesso após 200 e recarrega do backend', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }))
      .mockResolvedValueOnce(resp({ updated: 1, items: [linha({ position: 'Pintora', row_version: '4' })] }))
      .mockResolvedValueOnce(resp({ items: [linha({ position: 'Pintora', row_version: '4' })], total: 1 }));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    const input = screen.getByLabelText('Função/Cargo Ana Teste');
    fireEvent.change(input, { target: { value: 'Pintora' } });
    expect(input.getAttribute('data-changed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alterações' }));
    expect(screen.queryByText('Alterações salvas')).toBeNull();
    expect(await screen.findByText('Alterações salvas')).toBeTruthy();
    const patch = chamadas(fetchMock, 'PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0][0]).toBe('/api/employees/bulk');
    expect(JSON.parse((patch[0][1] as RequestInit).body as string)).toEqual({
      changes: [{ id: 'e1', row_version: '3', fields: { position: 'Pintora' } }],
    });
    await waitFor(() => expect(chamadas(fetchMock, 'GET')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Editar tabela' })).toBeTruthy();
  });

  it('converte data DD/MM/AAAA para ISO no envio', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }))
      .mockResolvedValueOnce(resp({ updated: 1, items: [] }))
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    fireEvent.change(screen.getByLabelText('Data de admissão Ana Teste'), { target: { value: '10/02/2021' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alterações' }));
    await screen.findByText('Alterações salvas');
    const body = JSON.parse((chamadas(fetchMock, 'PATCH')[0][1] as RequestInit).body as string);
    expect(body.changes[0].fields).toEqual({ admission_date: '2021-02-10' });
  });

  it('data inválida bloqueia o envio com mensagem na célula', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ items: [linha()], total: 1 }));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    fireEvent.change(screen.getByLabelText('Data de nascimento Ana Teste'), { target: { value: '99/99/2020' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alterações' }));
    expect(await screen.findByText('Data inválida. Use DD/MM/AAAA.')).toBeTruthy();
    expect(chamadas(fetchMock, 'PATCH')).toHaveLength(0);
  });

  it('Cancelar descarta o rascunho sem PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ items: [linha()], total: 1 }));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    fireEvent.change(screen.getByLabelText('Função/Cargo Ana Teste'), { target: { value: 'Outra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect((screen.getByLabelText('Função/Cargo Ana Teste') as HTMLInputElement).value).toBe('Soldadora');
    expect(chamadas(fetchMock, 'PATCH')).toHaveLength(0);
  });

  it('400 com errors mostra a mensagem na célula e mantém a edição aberta', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }))
      .mockResolvedValueOnce(resp({ message: 'Dados inválidos', errors: { 'e1.cpf': 'CPF inválido' } }, 400));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    fireEvent.change(screen.getByLabelText('CPF Ana Teste'), { target: { value: '11111111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alterações' }));
    expect(await screen.findByText('CPF inválido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar alterações' })).toBeTruthy();
    expect((screen.getByLabelText('CPF Ana Teste') as HTMLInputElement).value).toBe('11111111111');
    expect(screen.queryByText('Alterações salvas')).toBeNull();
  });

  it('409 mostra a mensagem geral em role=alert', async () => {
    const msg = 'Esta linha foi alterada por outra pessoa. Atualize a tabela e refaça a edição.';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }))
      .mockResolvedValueOnce(resp({ message: msg }, 409));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    fireEvent.change(screen.getByLabelText('Função/Cargo Ana Teste'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alterações' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain(msg);
    expect((screen.getByLabelText('Função/Cargo Ana Teste') as HTMLInputElement).value).toBe('X');
  });

  it('Atualizar tabela refaz o GET', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp({ items: [linha()], total: 1 }))
      .mockResolvedValueOnce(resp({ items: [linha({ position: 'Nova' })], total: 1 }));
    await abrir(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar tabela' }));
    expect(await screen.findByDisplayValue('Nova')).toBeTruthy();
    expect(chamadas(fetchMock, 'GET')).toHaveLength(2);
  });

  it('paginação: Próxima pede offset 50', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp({ items: [linha()], total: 120 }));
    await abrir(fetchMock);
    expect(screen.getByText('1–50 de 120')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe('/api/employees/table?limit=50&offset=50'));
  });
});
