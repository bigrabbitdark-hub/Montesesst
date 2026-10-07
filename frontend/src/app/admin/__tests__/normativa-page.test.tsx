import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminNormativaPage from '../normativa/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const FONTE = {
  id: 's1', entity: 'MTE', code: 'NR-06', title: 'Equipamento de Proteção Individual', official_url: 'https://exemplo.gov.br/nr06',
  active: true, last_checked_at: null, last_check_status: 'erro' as const, last_error: 'timeout', consecutive_failures: 2,
};
const DOC_PENDENTE = { id: 'd1', source_id: 's1', status: 'aguardando_validacao', file_name: 'nr06-v2.pdf', detected_at: '2026-10-01T00:00:00Z', indexed_at: null, rejection_reason: null };
const DOC_VIGENTE = { id: 'd2', source_id: 's1', status: 'vigente', file_name: 'nr06-v1.pdf', detected_at: '2026-09-01T00:00:00Z', indexed_at: null, rejection_reason: null };

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/normative-sources' && !init?.method) return ok([FONTE]);
    if (url === '/api/normative-documents?status=aguardando_validacao') return ok([DOC_PENDENTE]);
    if (url === '/api/normative-documents?status=vigente') return ok([DOC_VIGENTE]);
    if (url === '/api/normative-documents/d1') return ok({ document: { ...DOC_PENDENTE, raw_text: 'Texto novo da NR' }, previous_text: null });
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/normativa (DS v2)', () => {
  it('mostra o título e os cartões Fontes, Aguardando validação e Vigentes', async () => {
    render(<AdminNormativaPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Base normativa' })).toBeInTheDocument();
    for (const nome of ['Fontes monitoradas', 'Aguardando validação (1)', 'Vigentes (1)']) {
      expect((await screen.findByRole('heading', { level: 3, name: nome })).closest('section')).toHaveClass('adm-card');
    }
  });

  it('a fonte com falhas mostra um Badge "bad" com o texto original; campos e botão usam os primitivos', async () => {
    render(<AdminNormativaPage />);
    const falha = await screen.findByText('Falhando (2) — timeout');
    expect(falha.closest('span.rounded-full')).not.toBeNull();
    expect(falha.closest('span.rounded-full')!.className).toContain('text-adm-status-crit-text');
    expect(screen.getByPlaceholderText('Entidade (ex: MTE)')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Cadastrar fonte' })).toHaveClass('adm-btn', 'adm-btn-primary');
  });

  it('cadastrar fonte continua enviando o mesmo POST (código vazio fica de fora)', async () => {
    render(<AdminNormativaPage />);
    fireEvent.change(await screen.findByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'NR de teste' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://exemplo.gov.br/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    await waitFor(() => expect(chamadas('/api/normative-sources', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources', 'POST')[0][1].body)).toEqual({
      entity: 'MTE',
      title: 'NR de teste',
      official_url: 'https://exemplo.gov.br/x',
    });
  });

  it('revisar: o painel abre em destaque, Aprovar envia POST /approve e Rejeitar só habilita com motivo', async () => {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const painel = (await screen.findByRole('heading', { level: 3, name: 'Revisar versão' })).closest('section');
    expect(painel).toHaveClass('adm-card');
    expect(screen.getByText('Texto novo da NR')).toBeInTheDocument();

    const rejeitar = screen.getByRole('button', { name: 'Rejeitar' });
    expect(rejeitar).toHaveClass('adm-btn', 'adm-btn-danger');
    expect(rejeitar).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Motivo da rejeição'), { target: { value: 'Texto incompleto' } });
    expect(rejeitar).toBeEnabled();
    fireEvent.click(rejeitar);
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/reject', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-documents/d1/reject', 'POST')[0][1].body)).toEqual({ reason: 'Texto incompleto' });
  });

  it('aprovar envia POST /approve do documento aberto', async () => {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/approve', 'POST')).toHaveLength(1));
  });

  it('documento vigente sem indexação mostra "Reindexar" e envia POST /reindex', async () => {
    render(<AdminNormativaPage />);
    const botao = await screen.findByRole('button', { name: 'Reindexar' });
    expect(botao).toHaveClass('adm-link');
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas('/api/normative-documents/d2/reindex', 'POST')).toHaveLength(1));
  });
});

describe('/admin/normativa — acessibilidade e nomes longos', () => {
  it('os campos do cadastro de fonte têm nome acessível (aria-label igual ao placeholder)', async () => {
    render(<AdminNormativaPage />);
    for (const nome of ['Entidade (ex: MTE)', 'Código (ex: NR-06)', 'Título', 'URL oficial']) {
      expect(await screen.findByLabelText(nome)).toBeInTheDocument();
    }
  });

  it('o campo do motivo da rejeição também tem nome acessível', async () => {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    expect(await screen.findByLabelText('Motivo da rejeição')).toBeInTheDocument();
  });

  it('as linhas de documento quebram em vez de vazar quando o nome do arquivo é longo', async () => {
    render(<AdminNormativaPage />);
    const pendente = (await screen.findByText(/nr06-v2\.pdf/)).closest('li');
    const vigente = screen.getByText(/nr06-v1\.pdf/).closest('li');
    for (const li of [pendente, vigente]) {
      expect(li).toHaveClass('flex-wrap');
      expect(li!.querySelector('span')).toHaveClass('min-w-0', 'break-words');
    }
  });
});
