import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
// Roteador estável como o do Next: um objeto novo a cada render reexecutaria o efeito de montagem.
const router = { push };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import Funcionarios from '../funcionarios/page';

const REVIEW = {
  id: 'x9', tenant_id: 't', document_id: 'd', status: 'requer_revisao',
  summary: { applied: 0, unchanged: 0, novo: 1, conflito: 0, invalida: 0, ignored_rows: 0 },
  items: [{ line: 10, kind: 'novo', full_name: 'Nova Ficticia', cpf_masked: '***.***.***-25' }],
  created_at: '2026-10-14T10:00:00Z', resolved_at: null,
};

function resp(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

const UNITS = [{ id: 'u1', name: 'Matriz SP' }, { id: 'u2', name: 'Filial RJ' }];

describe('página /empresa/funcionarios', () => {
  beforeEach(() => push.mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sem token redireciona para /login e não busca nada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra o cabeçalho, a tabela e recarrega a tabela após cadastrar', async () => {
    localStorage.setItem('montese_token', 'x');
    const tabela = vi.fn(() => resp({ items: [], total: 0 }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      if (url.startsWith('/api/employees/extractions')) return resp({ items: [] });
      if (url.startsWith('/api/employees/table')) return tabela();
      if (url === '/api/employees' && init?.method === 'POST') return resp({ id: 'n' }, 201);
      return resp({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    expect(await screen.findByRole('heading', { name: 'Funcionários' })).toBeTruthy();
    await screen.findByText('Nenhum funcionário cadastrado ainda.');
    expect(tabela).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar funcionário' }));
    fireEvent.change(screen.getByLabelText(/^Funcionário/), { target: { value: 'Ana Teste' } });
    fireEvent.change(screen.getByLabelText(/^CPF/), { target: { value: '52998224725' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    await screen.findByText('Funcionário cadastrado');
    await waitFor(() => expect(tabela).toHaveBeenCalledTimes(2));
  });

  it('o filtro de filial recarrega a tabela com company_unit_id', async () => {
    localStorage.setItem('montese_token', 'x');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      return resp({ items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    await screen.findByRole('option', { name: 'Filial RJ' });
    fireEvent.change(screen.getByLabelText('Filtrar por filial'), { target: { value: 'u2' } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/employees/table') && String(u).includes('company_unit_id=u2'))).toBe(true),
    );
  });

  it('em edição da tabela, filtro de filial e Adicionar funcionário ficam desabilitados e voltam após cancelar', async () => {
    localStorage.setItem('montese_token', 'x');
    const item = {
      id: 'e1', sequence: 1, row_version: '1', full_name: 'Ana Teste', esocial_registration: null, cpf: '52998224725',
      birth_date: null, sex: null, position: null, admission_date: null, cbo_code: null, activity_description: null,
      company_unit_id: null, status: 'active',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('/api/company-units') ? resp(UNITS)
        : url.startsWith('/api/employees/extractions') ? resp({ items: [] })
        : resp({ items: [item], total: 1 })));
    render(<Funcionarios />);
    await screen.findByDisplayValue('Ana Teste');
    await screen.findByRole('option', { name: 'Filial RJ' });
    const filtro = () => screen.getByLabelText('Filtrar por filial') as HTMLSelectElement;
    const add = () => screen.getByRole('button', { name: 'Adicionar funcionário' }) as HTMLButtonElement;
    expect(filtro().disabled).toBe(false);
    expect(add().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    expect(filtro().disabled).toBe(true);
    expect(add().disabled).toBe(true);
    expect(screen.getByText('Confirme ou cancele a edição para trocar de filial ou cadastrar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(filtro().disabled).toBe(false);
    expect(add().disabled).toBe(false);
    expect(screen.queryByText('Confirme ou cancele a edição para trocar de filial ou cadastrar.')).toBeNull();
  });

  it('com revisão pendente, mostra o painel acima da tabela e trava o anexo; ao resolver, recarrega a tabela', async () => {
    localStorage.setItem('montese_token', 'x');
    const tabela = vi.fn(() => resp({ items: [], total: 0 }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      if (url === '/api/employees/extractions?status=requer_revisao') return resp({ items: [REVIEW] });
      if (url === '/api/employees/extractions/x9/resolve' && init?.method === 'POST') {
        return resp({ ...REVIEW, status: 'aplicado', items: [], summary: { ...REVIEW.summary, resolved: { aplicados: 1, ignorados: 0 } } });
      }
      if (url.startsWith('/api/employees/table')) return tabela();
      return resp({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    const panel = await screen.findByRole('region', { name: 'Revisão da planilha enviada' });
    const tableHeading = await screen.findByText('Nenhum funcionário cadastrado ainda.');
    expect(panel.compareDocumentPosition(tableHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anexar documento' }) as HTMLButtonElement).disabled).toBe(true);
    expect(tabela).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/^Cadastrar Nova Ficticia/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await screen.findByText('1 aplicados, 0 ignorados.');
    await waitFor(() => expect(tabela).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Anexar documento' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('region', { name: 'Revisão da planilha enviada' })).toBeNull();
  });

  it('o anexo fica desabilitado durante a edição da tabela e a falha da lista de revisões não quebra a página', async () => {
    localStorage.setItem('montese_token', 'x');
    const item = {
      id: 'e1', sequence: 1, row_version: '1', full_name: 'Ana Teste', esocial_registration: null, cpf: '52998224725',
      birth_date: null, sex: null, position: null, admission_date: null, cbo_code: null, activity_description: null,
      company_unit_id: null, status: 'active',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/employees/extractions')) throw new Error('rede');
      return url.startsWith('/api/company-units') ? resp(UNITS) : resp({ items: [item], total: 1 });
    }));
    render(<Funcionarios />);
    await screen.findByDisplayValue('Ana Teste');
    const anexar = () => screen.getByRole('button', { name: 'Anexar documento' }) as HTMLButtonElement;
    expect(anexar().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tabela' }));
    expect(anexar().disabled).toBe(true);
    expect(screen.queryByRole('region', { name: 'Revisão da planilha enviada' })).toBeNull();
  });

  it('upload com requer_revisao abre o painel de revisão; upload aplicado recarrega a tabela', async () => {
    localStorage.setItem('montese_token', 'x');
    const tabela = vi.fn(() => resp({ items: [], total: 0 }));
    let next: unknown = REVIEW;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      if (url.startsWith('/api/employees/extractions')) return resp({ items: [] });
      if (url === '/api/employees/documents' && init?.method === 'POST') return resp(next, 201);
      if (url.startsWith('/api/employees/table')) return tabela();
      return resp({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    await screen.findByText('Nenhum funcionário cadastrado ainda.');
    const enviar = async () => {
      fireEvent.change(screen.getByLabelText(/Planilha/), {
        target: { files: [new File(['x'], 'c.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    };
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    await enviar();
    await screen.findByRole('region', { name: 'Revisão da planilha enviada' });
    expect(tabela).toHaveBeenCalledTimes(1);

    // Fecha a revisão e envia outra planilha que se aplica sozinha.
    fireEvent.click(screen.getByRole('button', { name: 'Decidir depois' }));
    expect(screen.queryByRole('region', { name: 'Revisão da planilha enviada' })).toBeNull();
    next = { ...REVIEW, id: 'x10', status: 'aplicado', items: [], summary: { ...REVIEW.summary, applied: 2, novo: 0 } };
    await waitFor(() => expect((screen.getByRole('button', { name: 'Enviar e analisar' }) as HTMLButtonElement).disabled).toBe(false));
    await enviar();
    await waitFor(() => expect(tabela).toHaveBeenCalledTimes(2));
  });

  it('upload com requer_revisao antes da listagem inicial responder: a listagem tardia não substitui a revisão nova', async () => {
    localStorage.setItem('montese_token', 'x');
    const NEW_REVIEW = { ...REVIEW, id: 'x11', items: [{ line: 10, kind: 'novo', full_name: 'Recente Ficticia', cpf_masked: '***.***.***-35' }] };
    const OLD_REVIEW = { ...REVIEW, id: 'x1', items: [{ line: 10, kind: 'novo', full_name: 'Antiga Ficticia', cpf_masked: '***.***.***-25' }] };
    let releaseList: (r: Response) => void = () => {};
    const late = new Promise<Response>((r) => { releaseList = r; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      if (url === '/api/employees/extractions?status=requer_revisao') return late;
      if (url === '/api/employees/documents' && init?.method === 'POST') return resp(NEW_REVIEW, 201);
      if (url.startsWith('/api/employees/table')) return resp({ items: [], total: 0 });
      return resp({}, 404);
    }));
    render(<Funcionarios />);
    await screen.findByText('Nenhum funcionário cadastrado ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    fireEvent.change(screen.getByLabelText(/Planilha/), {
      target: { files: [new File(['x'], 'c.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await screen.findByText(/Recente Ficticia/);
    releaseList(resp({ items: [OLD_REVIEW] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/Recente Ficticia/)).toBeTruthy();
    expect(screen.queryByText(/Antiga Ficticia/)).toBeNull();
  });
});
