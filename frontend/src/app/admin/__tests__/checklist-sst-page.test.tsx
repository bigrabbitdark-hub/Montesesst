import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminChecklistSstPage from '../checklist-sst/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const ITEM = {
  id: 'i1', nr_code: 'NR-13', nr_title: 'Caldeiras', nr_category: 'especial', document_name: 'Prontuário de caldeira',
  description: 'Descrição', legal_requirement: 'Requisito', infraction_index: 2, is_fine_validated: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
let rolar: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  rolar = vi.fn();
  Element.prototype.scrollIntoView = rolar; // jsdom não implementa
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/sst-checklist') && !init?.method) return ok([ITEM]);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/checklist-sst (DS v2)', () => {
  it('mostra título, descrição e os cartões "Novo item" e a lista, com campos e botões nos primitivos', async () => {
    render(<AdminChecklistSstPage />);
    expect(await screen.findByRole('heading', { level: 2, name: /Checklist SST/ })).toBeInTheDocument();
    expect(screen.getByText(/Curadoria interna da Montese/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Novo item' }).closest('section')).toHaveClass('adm-card');
    expect((await screen.findByRole('heading', { level: 3, name: 'Itens (1)' })).closest('section')).toHaveClass('adm-card');
    expect(screen.getByLabelText('Código da NR')).toHaveClass('adm-input');
    expect(screen.getByLabelText('Categoria')).toHaveClass('adm-input');
    expect(screen.getByLabelText('Descrição')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar item' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByLabelText('Filtrar por NR')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveClass('adm-btn');
    expect(await screen.findByRole('button', { name: 'Editar' })).toHaveClass('adm-link');
  });

  it('criar item continua enviando o mesmo POST (índice vazio vira null)', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.change(await screen.findByLabelText('Código da NR'), { target: { value: 'NR-06' } });
    fireEvent.change(screen.getByLabelText('Título da NR'), { target: { value: 'EPI' } });
    fireEvent.change(screen.getByLabelText('Nome do documento'), { target: { value: 'Ficha de EPI' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Descrição do documento' } });
    fireEvent.change(screen.getByLabelText('Requisito legal'), { target: { value: 'Requisito do documento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar item' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/sst-checklist', 'POST')[0][1].body)).toEqual({
      nr_code: 'NR-06',
      nr_title: 'EPI',
      nr_category: 'geral',
      document_name: 'Ficha de EPI',
      description: 'Descrição do documento',
      legal_requirement: 'Requisito do documento',
      infraction_index: null,
    });
  });

  it('editar: preenche o formulário, rola até ele e envia PATCH com o corpo atualizado', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Editar item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Código da NR')).toHaveValue('NR-13');
    expect(rolar).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Nome do documento'), { target: { value: 'Prontuário atualizado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist/i1', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/sst-checklist/i1', 'PATCH')[0][1].body)).toMatchObject({
      nr_code: 'NR-13',
      document_name: 'Prontuário atualizado',
      infraction_index: 2,
    });
  });

  it('excluir pede confirmação e envia DELETE', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AdminChecklistSstPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist/i1', 'DELETE')).toHaveLength(1));
  });

  it('filtrar por NR consulta /api/sst-checklist?nr_code=…', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.change(await screen.findByLabelText('Filtrar por NR'), { target: { value: 'NR-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/sst-checklist?nr_code=NR-13')).toBe(true),
    );
  });
});
