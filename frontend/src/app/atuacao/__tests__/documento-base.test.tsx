import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { BasePgr } from '../documentos/[id]/BasePgr';
import { Tecnicos } from '../empresas/[tenantId]/Secoes';

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let rotas: Record<string, (init?: RequestInit) => Response>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  rotas = {};
  fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    const r = rotas[`${init?.method ?? 'GET'} ${String(u).replace('/api/atuacao', '')}`];
    return r ? r(init) : resp(404, { message: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const pgr = (over: Record<string, unknown> = {}) => ({ id: 'p-1', title: 'PGR da empresa', status: 'publicado', versao_atual: 2, ...over });
const base = { id: 'p-1', title: 'PGR da empresa', category: 'pgr', status: 'publicado' as const, versao: 2 };
const props = (over: Record<string, unknown> = {}) => ({
  docId: 'd-1', tenantId: 't-1', category: 'ltcat', status: 'em_elaboracao', base: null, avisos: [], derivados: [], onMudou: vi.fn(), ...over,
});

describe('BasePgr', () => {
  it('categoria sem PGR-base e sem derivados não renderiza nada', () => {
    const { container } = render(<BasePgr {...props({ category: 'pcmso' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('LTCAT em elaboração: lista os PGR da empresa e salva o vínculo (PATCH)', async () => {
    rotas['GET /documentos?tenantId=t-1&category=pgr'] = () => resp(200, [pgr(), pgr({ id: 'p-2', title: 'PGR cancelado', status: 'cancelado' })]);
    rotas['PATCH /documentos/d-1/base'] = () => resp(200, { id: 'd-1', base_draft_id: 'p-1' });
    const onMudou = vi.fn();
    render(<BasePgr {...props({ onMudou })} />);
    expect(screen.getByText('Nenhum PGR vinculado. O vínculo é opcional.')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('option', { name: /PGR da empresa/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /PGR cancelado/ })).toBeNull();
    const botao = screen.getByRole('button', { name: 'Remover vínculo' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('PGR da mesma empresa'), { target: { value: 'p-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ base_draft_id: 'p-1' });
  });

  it('mostra base, avisos do servidor e remove o vínculo; erro do servidor aparece como alerta', async () => {
    rotas['GET /documentos?tenantId=t-1&category=pgr'] = () => resp(200, [pgr()]);
    rotas['PATCH /documentos/d-1/base'] = () => resp(409, { message: 'PGR-base inválido: use um PGR da mesma empresa.' });
    render(<BasePgr {...props({ base, avisos: [{ codigo: 'base_mais_nova', mensagem: 'O PGR-base tem uma versão mais recente.' }] })} />);
    expect(screen.getByRole('link', { name: 'PGR da empresa' }).getAttribute('href')).toBe('/atuacao/documentos/p-1');
    expect(screen.getByText('O PGR-base tem uma versão mais recente.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PGR da mesma empresa'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remover vínculo' }));
    expect((await screen.findByRole('alert')).textContent).toContain('PGR-base inválido');
  });

  it('fora da elaboração é só leitura (sem seletor, sem busca de PGRs)', () => {
    render(<BasePgr {...props({ status: 'publicado', base })} />);
    expect(screen.queryByLabelText('PGR da mesma empresa')).toBeNull();
    expect(screen.getByText(/só pode ser alterado com o documento em elaboração/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PGR lista os documentos derivados', () => {
    render(<BasePgr {...props({ category: 'pgr', derivados: [{ id: 'l-1', category: 'ltcat', title: 'LTCAT 2026', status: 'em_revisao', versao: 1 }] })} />);
    expect(screen.getByRole('heading', { name: 'Documentos que partem deste PGR' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'LTCAT 2026' }).getAttribute('href')).toBe('/atuacao/documentos/l-1');
  });
});

describe('Tecnicos (aba da empresa)', () => {
  it('um cartão por tipo técnico, com etapa, correções pendentes e avisos; tipo ausente diz que não há documento', async () => {
    rotas['GET /documentos/empresa/t-1/tecnicos'] = () => resp(200, [
      { id: 'p-1', category: 'pgr', title: 'PGR 2026', status: 'publicado', versao: 2, base_draft_id: null, correcoes_pendentes: 0, updated_at: '2026-11-01T00:00:00Z', avisos_base: [] },
      { id: 'l-1', category: 'ltcat', title: 'LTCAT 2026', status: 'em_revisao', versao: 1, base_draft_id: 'p-1', correcoes_pendentes: 2, updated_at: '2026-11-01T00:00:00Z',
        avisos_base: [{ codigo: 'base_mais_nova', mensagem: 'O PGR-base tem uma versão mais recente.' }] },
    ]);
    render(<Tecnicos tenantId="t-1" />);
    expect(await screen.findByRole('link', { name: 'PGR 2026' })).toBeTruthy();
    expect(screen.getByText('2 correções pendentes')).toBeTruthy();
    expect(screen.getByText(/O PGR-base tem uma versão mais recente\./)).toBeTruthy();
    expect(screen.getAllByText('Nenhum documento deste tipo.')).toHaveLength(3);
  });

  it('erro 404 vira "Empresa não encontrada." com opção de tentar de novo', async () => {
    render(<Tecnicos tenantId="t-1" />);
    expect(await screen.findByText('Empresa não encontrada.')).toBeTruthy();
  });
});
