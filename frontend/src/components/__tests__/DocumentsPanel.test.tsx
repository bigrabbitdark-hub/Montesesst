import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentsPanel } from '../DocumentsPanel';

interface DocumentRowResponse {
  id: string;
  category: string;
  title: string;
  file_name: string;
  valid_from: string | null;
  expires_at: string | null;
  expires_source: 'manual' | 'rule' | null;
  validity_months_applied: number | null;
  situacao: 'valido' | 'vencendo' | 'vencido' | 'sem_vencimento';
  uploaded_by_user_id: string;
  company_unit_id: string | null;
  created_at: string;
}

function makeResponse(body: unknown, status = 200, headers = new Headers()): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  } as Response;
}

const baseRules = [
  { category: 'pgr', validity_months: 12, alert_days: 30 },
  { category: 'pcmso', validity_months: 12, alert_days: 30 },
  { category: 'treinamento', validity_months: null, alert_days: 30 },
];

function setupFetchMock(opts: {
  documents?: DocumentRowResponse[];
  rules?: { category: string; validity_months: number | null; alert_days: number }[] | null;
  rulesStatus?: number;
} = {}) {
  const documents: DocumentRowResponse[] = opts.documents ?? [];
  const rules = opts.rules === undefined ? baseRules : opts.rules;
  const rulesStatus = opts.rulesStatus ?? 200;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/api/documents/validity-rules')) {
      if (rules === null || rulesStatus >= 400) {
        return makeResponse({ message: 'erro' }, rulesStatus || 500);
      }
      return makeResponse(rules);
    }
    if (url.includes('/api/documents/compliance')) {
      return makeResponse({ score: null, pendencias: [], avisos: [] });
    }
    if (url.includes('/api/epis')) {
      return makeResponse([]);
    }
    if (url.includes('/api/company-units')) {
      return makeResponse([]);
    }
    if (url.includes('/api/documents') && method === 'GET') {
      return makeResponse(documents);
    }
    return makeResponse({ message: 'mock não preparou essa rota' }, 500);
  });

  return fetchMock;
}

describe('DocumentsPanel — validade de documentos', () => {
  beforeEach(() => {
    localStorage.setItem('montese_token', 'test-token');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'user-1' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('ao informar início em categoria com regra, mostra o vencimento calculado', async () => {
    const fetchMock = setupFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);

    // espera o componente terminar o carregamento inicial (seção "Enviar documento" montada)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Enviar documento' })).toBeInTheDocument());

    // Preenche título (obrigatório), data de início, e checa o cálculo
    const titleInput = screen.getByLabelText('Título');
    fireEvent.change(titleInput, { target: { value: 'PGR 2026' } });

    const validFromInput = screen.getByLabelText('Início da validade');
    fireEvent.change(validFromInput, { target: { value: '2026-03-01' } });

    await waitFor(() => {
      expect(screen.getByTestId('upload-calculated-hint')).toHaveTextContent('Vencimento calculado: 01/03/2027');
    });
    // Categoria padrão é 'pgr' (12 meses)
    expect(screen.getByTestId('upload-calculated-hint')).toHaveTextContent('regra configurável de 12 meses');

    // O input de vencimento foi preenchido com 2027-03-01
    const expiresInput = screen.getByLabelText('Vencimento (opcional)') as HTMLInputElement;
    expect(expiresInput.value).toBe('2027-03-01');
  });

  it('categoria sem regra mostra o aviso e deixa o campo de vencimento vazio', async () => {
    const fetchMock = setupFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Enviar documento' })).toBeInTheDocument());

    // Categoria "treinamento" não tem regra (validity_months null)
    const categorySelect = screen.getByLabelText('Categoria');
    fireEvent.change(categorySelect, { target: { value: 'treinamento' } });

    fireEvent.change(screen.getByLabelText('Início da validade'), {
      target: { value: '2026-03-01' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-no-rule-hint')).toHaveTextContent(
        'Este tipo de documento não tem vencimento automático definido',
      );
    });

    const expiresInput = screen.getByLabelText('Vencimento (opcional)') as HTMLInputElement;
    expect(expiresInput.value).toBe('');
  });

  it('lista mostra as duas datas e o selo de situação', async () => {
    const documents: DocumentRowResponse[] = [
      {
        id: 'doc-1',
        category: 'pgr',
        title: 'PGR 2026',
        file_name: 'pgr.pdf',
        valid_from: '2026-03-01',
        expires_at: '2027-03-01',
        expires_source: 'rule',
        validity_months_applied: 12,
        situacao: 'valido',
        uploaded_by_user_id: 'user-1',
        company_unit_id: null,
        created_at: '2026-03-01T12:00:00Z',
      },
    ];
    const fetchMock = setupFetchMock({ documents });
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('doc-dates-doc-1')).toHaveTextContent('Início: 01/03/2026');
    });
    expect(screen.getByTestId('doc-dates-doc-1')).toHaveTextContent('Vencimento: 01/03/2027');
    expect(screen.getByTestId('doc-dates-doc-1')).toHaveTextContent('calculado por regra');

    // Selo com texto
    expect(screen.getByText('Válido')).toBeInTheDocument();
  });

  it('registro antigo sem datas mostra "Não informado" e "Não definido"', async () => {
    const documents: DocumentRowResponse[] = [
      {
        id: 'doc-old',
        category: 'pgr',
        title: 'PGR antigo',
        file_name: 'old.pdf',
        valid_from: null,
        expires_at: null,
        expires_source: null,
        validity_months_applied: null,
        situacao: 'sem_vencimento',
        uploaded_by_user_id: 'user-1',
        company_unit_id: null,
        created_at: '2025-01-01T12:00:00Z',
      },
    ];
    const fetchMock = setupFetchMock({ documents });
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('doc-dates-doc-old')).toHaveTextContent('Início: Não informado');
    });
    expect(screen.getByTestId('doc-dates-doc-old')).toHaveTextContent('Vencimento: Não definido');
    expect(screen.getByText('Sem vencimento definido')).toBeInTheDocument();
  });

  it('data não desloca um dia por fuso: 2026-03-01 continua sendo 01/03/2026', async () => {
    const documents: DocumentRowResponse[] = [
      {
        id: 'doc-tz',
        category: 'pgr',
        title: 'PGR fuso',
        file_name: 'pgr-tz.pdf',
        valid_from: '2026-03-01',
        expires_at: '2027-03-01',
        expires_source: 'rule',
        validity_months_applied: 12,
        situacao: 'valido',
        uploaded_by_user_id: 'user-1',
        company_unit_id: null,
        created_at: '2026-03-01T12:00:00Z',
      },
    ];
    const fetchMock = setupFetchMock({ documents });
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('doc-dates-doc-tz')).toHaveTextContent('Início: 01/03/2026');
    });
    expect(screen.getByTestId('doc-dates-doc-tz')).toHaveTextContent('Vencimento: 01/03/2027');
    expect(screen.getByTestId('doc-dates-doc-tz').textContent).not.toMatch(/28\/02/);
  });

  it('se a chamada de regras falhar, formulário continua funcionando sem cálculo automático', async () => {
    const fetchMock = setupFetchMock({ rules: null, rulesStatus: 500 });
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Enviar documento' })).toBeInTheDocument());

    expect(
      screen.getByText(/Não foi possível carregar as regras de validade/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Início da validade'), {
      target: { value: '2026-03-01' },
    });

    // Sem regras, não deve aparecer cálculo automático
    expect(screen.queryByTestId('upload-calculated-hint')).not.toBeInTheDocument();

    const expiresInput = screen.getByLabelText('Vencimento (opcional)') as HTMLInputElement;
    expect(expiresInput.value).toBe('');
  });
});
