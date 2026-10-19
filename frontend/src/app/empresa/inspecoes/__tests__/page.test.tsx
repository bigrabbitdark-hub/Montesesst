import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EmpresaInspecoesPage from '../page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const inspectionsPayload = [
  { id: 'insp-1', status: 'concluida', visited_at: '2026-09-15', company_unit_id: 'unit-1', documentos_count: 2 },
  { id: 'insp-2', status: 'rascunho', visited_at: '2026-08-20', company_unit_id: 'unit-1', documentos_count: 0 },
];

const actionPlansPayload = [
  { id: 'plan-1', description: 'Instalar nova fiação', status: 'pendente', inspection_id: 'insp-1' },
  { id: 'plan-2', description: 'Treinamento de EPI', status: 'resolvido', inspection_id: 'insp-1' },
];

const detailPayload = {
  id: 'insp-1',
  status: 'concluida',
  visited_at: '2026-09-15',
  company_unit_id: 'unit-1',
  documentos_count: 2,
  company_contact: 'João da Silva',
  general_recommendations: 'Revisar extintores em 30 dias.',
  items: [
    { id: 'item-1', block: 'epis', item_label: 'Uso de capacete', status: 'NC', notes: 'Setor sem estoque' },
    { id: 'item-2', block: 'documentacao', item_label: 'ASO atualizado', status: 'C', notes: null },
  ],
  action_plans: actionPlansPayload,
  documentos_anexos: [
    { id: 'doc-1', title: 'Relatório de Visita — 2026-09-15', file_name: 'relatorio.pdf', mime_type: 'application/pdf', size_bytes: 1024, uploaded_by_role: 'tecnico', created_at: '2026-09-15T13:00:00.000Z' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

describe('Página /empresa/inspecoes (Etapa 1 — Relatório de Visita Técnica)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem('montese_token', 'test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function mockInitialLoad() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/inspections') return jsonResponse(inspectionsPayload);
      if (url === '/api/action-plans') return jsonResponse(actionPlansPayload);
      return jsonResponse({}, 404);
    });
  }

  it('carrega inspeções e mostra o resumo da última visita concluída + planos pendentes', async () => {
    mockInitialLoad();

    render(<EmpresaInspecoesPage />);

    // Resumo da última visita: a data aparece no card de resumo
    // e na timeline, então usamos findAllByText.
    const dates = await screen.findAllByText(/15\/09\/2026/);
    expect(dates.length).toBeGreaterThanOrEqual(1);
    // "Concluída" aparece no resumo e na timeline — confirmamos
    // que está pelo menos 1 vez (>= 2 = uma em cada lugar).
    const concluidas = screen.getAllByText('Concluída');
    expect(concluidas.length).toBeGreaterThanOrEqual(1);
    // Planos pendentes aparecem (só o pendente, não o resolvido)
    expect(screen.getByText('Instalar nova fiação')).toBeTruthy();
    expect(screen.queryByText('Treinamento de EPI')).toBeNull();
  });

  it('abre o modal ao clicar em "Anexar relatório" e exige escolher inspeção', async () => {
    mockInitialLoad();

    render(<EmpresaInspecoesPage />);

    const openButton = await screen.findByRole('button', { name: 'Anexar relatório' });
    fireEvent.click(openButton);

    expect(await screen.findByText('Anexar relatório de visita')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Enviar' });
    expect(submit).toBeDisabled();
  });

  it('abre detalhe ao clicar em "Ver relatório completo" e mostra anexos + checklist', async () => {
    mockInitialLoad();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/inspections') return jsonResponse(inspectionsPayload);
      if (url === '/api/action-plans') return jsonResponse(actionPlansPayload);
      if (url === '/api/inspections/insp-1') return jsonResponse(detailPayload);
      return jsonResponse({}, 404);
    });

    render(<EmpresaInspecoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ver relatório completo' }));

    // Detalhe carregado — texto único da página de detalhe (com
    // "Relatório de visita —" antes da data evita o conflito com
    // a timeline que ainda está por baixo).
    expect(await screen.findByText(/Relatório de visita — 15\/09\/2026/)).toBeTruthy();
    // Anexo listado
    expect(screen.getByText('Relatório de Visita — 2026-09-15')).toBeTruthy();
    // Item NC do checklist "Uso de EPIs" — usa matcher de função
    // porque o label é quebrado por " — " (em-dash) na renderização.
    expect(screen.getByText((content) => content.startsWith('Uso de capacete'))).toBeTruthy();
  });

  it('mostra mensagem amigável quando o backend retorna 404 no detalhe', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/inspections') return jsonResponse(inspectionsPayload);
      if (url === '/api/action-plans') return jsonResponse(actionPlansPayload);
      if (url === '/api/inspections/insp-1') return jsonResponse({ message: 'not found' }, 404);
      return jsonResponse({}, 404);
    });

    render(<EmpresaInspecoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ver relatório completo' }));

    expect(await screen.findByText(/não está disponível para a sua empresa/)).toBeTruthy();
  });

  it('mostra a observação sobre PDFs antigos', async () => {
    mockInitialLoad();

    render(<EmpresaInspecoesPage />);

    expect(
      await screen.findByText(/PDFs gerados antes desta atualização não estão vinculados/),
    ).toBeTruthy();
  });
});
