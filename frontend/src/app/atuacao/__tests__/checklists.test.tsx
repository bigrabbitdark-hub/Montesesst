import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const push = vi.fn();
let params: Record<string, string> = { versionId: 'v-1', id: 'd-1' };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(''),
}));

import ChecklistsPage from '../checklists/page';
import ChecklistVersaoPage from '../checklists/versoes/[versionId]/page';
import { Checklists } from '../documentos/[id]/Checklists';

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let rotas: Record<string, (init?: RequestInit) => Response>;
beforeEach(() => {
  push.mockReset();
  params = { versionId: 'v-1', id: 'd-1' };
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  rotas = {};
  fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(u).replace('/api/atuacao', '')}`;
    const r = rotas[chave];
    return r ? r(init) : resp(404, { message: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const chamadas = (metodo: string) => fetchMock.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === metodo);

const item = (over: Record<string, unknown> = {}) => ({ id: 'i-1', position: 1, label: 'Item de teste', instruction: null, kind: 'sim_nao_na', required: true, blocks_review: false, ...over });
const versao = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', template_id: 't-1', service: 'pgr', name: 'Modelo de teste', version_number: 1, status: 'rascunho', change_note: null,
  created_by_name: 'Ana', approved_by_name: null, approved_at: null, itens: [item()], ...over,
});

describe('lista de modelos', () => {
  it('vazio explica que os itens vêm da engenharia; criar modelo exige nome e leva ao editor', async () => {
    rotas['GET /checklists/modelos'] = () => resp(200, []);
    rotas['POST /checklists/modelos'] = () => resp(201, versao({ id: 'v-9' }));
    render(<ChecklistsPage />);
    expect(await screen.findByText(/Nenhum modelo cadastrado ainda/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
    expect(await screen.findByText('Informe o nome do modelo.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome do novo modelo'), { target: { value: 'Modelo A' } });
    fireEvent.change(screen.getByLabelText('Serviço'), { target: { value: 'ltcat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/atuacao/checklists/versoes/v-9'));
    expect(JSON.parse((chamadas('POST')[0][1] as RequestInit).body as string)).toEqual({ service: 'ltcat', name: 'Modelo A' });
  });

  it('mostra aprovado, rascunho e links', async () => {
    rotas['GET /checklists/modelos'] = () => resp(200, [{ id: 't-1', service: 'pgr', name: 'M1', versao_aprovada_id: 'v-a', versao_aprovada: 2, rascunho_id: 'v-r', ultima_versao: 3 }]);
    render(<ChecklistsPage />);
    const lista = await screen.findByRole('list', { name: 'Modelos de checklist' });
    expect(within(lista).getByText('Aprovado v2')).toBeInTheDocument();
    expect(within(lista).getByText('Rascunho em edição')).toBeInTheDocument();
    expect(within(lista).getByRole('link', { name: 'Ver versão aprovada' })).toHaveAttribute('href', '/atuacao/checklists/versoes/v-a');
    expect(within(lista).getByRole('link', { name: 'Abrir rascunho' })).toHaveAttribute('href', '/atuacao/checklists/versoes/v-r');
  });

  it('403 mostra a mensagem do servidor', async () => {
    rotas['GET /checklists/modelos'] = () => resp(403, { message: 'Sem permissão.' });
    render(<ChecklistsPage />);
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });
});

describe('editor da versão', () => {
  it('rascunho: salva os itens com as regras e só bloqueia envio se obrigatório', async () => {
    rotas['GET /checklists/versoes/v-1'] = () => resp(200, versao());
    rotas['PUT /checklists/versoes/v-1/itens'] = () => resp(200, versao());
    render(<ChecklistVersaoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item' }));
    fireEvent.change(screen.getByLabelText('Item 2'), { target: { value: 'Segundo item' } });
    fireEvent.change(screen.getAllByLabelText('Tipo de resposta')[1], { target: { value: 'numero' } });
    const bloqueia = screen.getAllByLabelText('Bloqueia o envio para revisão')[1];
    fireEvent.click(bloqueia);
    fireEvent.click(screen.getAllByLabelText('Obrigatório')[1]); // desmarcar obrigatório desmarca o bloqueio
    expect(screen.getAllByLabelText('Bloqueia o envio para revisão')[1]).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar itens' }));
    await waitFor(() => expect(chamadas('PUT')).toHaveLength(1));
    expect(JSON.parse((chamadas('PUT')[0][1] as RequestInit).body as string).items).toEqual([
      { label: 'Item de teste', kind: 'sim_nao_na', required: true, blocks_review: false },
      { label: 'Segundo item', kind: 'numero', required: false, blocks_review: false },
    ]);
    expect(await screen.findByText('Itens salvos.')).toBeInTheDocument();
  });

  it('item sem texto não é enviado', async () => {
    rotas['GET /checklists/versoes/v-1'] = () => resp(200, versao());
    render(<ChecklistVersaoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar itens' }));
    expect(await screen.findByText('Todos os itens precisam de um texto.')).toBeInTheDocument();
    expect(chamadas('PUT')).toHaveLength(0);
  });

  it('aprovar pede confirmação que explica o efeito, salva e aprova', async () => {
    rotas['GET /checklists/versoes/v-1'] = () => resp(200, versao());
    rotas['PUT /checklists/versoes/v-1/itens'] = () => resp(200, versao());
    rotas['POST /checklists/versoes/v-1/aprovar'] = () => resp(201, versao({ status: 'aprovado', approved_by_name: 'Evelyn', approved_at: '2026-11-01T12:00:00Z' }));
    render(<ChecklistVersaoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar modelo' }));
    expect(screen.getByText(/os itens não poderão mais ser alterados/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));
    expect(await screen.findByText(/Modelo aprovado/)).toBeInTheDocument();
    expect(chamadas('PUT')).toHaveLength(1);
    expect(chamadas('POST')).toHaveLength(1);
    expect(await screen.findByText(/Versão aprovada não pode ser alterada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar itens' })).toBeNull();
  });

  it('aprovada: somente leitura e oferece nova versão', async () => {
    rotas['GET /checklists/versoes/v-1'] = () => resp(200, versao({ status: 'aprovado', approved_by_name: 'Evelyn', approved_at: '2026-11-01T12:00:00Z' }));
    rotas['POST /checklists/modelos/t-1/versoes'] = () => resp(201, versao({ id: 'v-2', version_number: 2 }));
    render(<ChecklistVersaoPage />);
    expect(await screen.findByText(/Aprovado por Evelyn/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Item 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Criar nova versão' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/atuacao/checklists/versoes/v-2'));
  });

  it('excluir rascunho (204) volta para a lista', async () => {
    rotas['GET /checklists/versoes/v-1'] = () => resp(200, versao());
    rotas['DELETE /checklists/versoes/v-1'] = () => ({ ok: true, status: 204, json: async () => { throw new Error('sem corpo'); } } as unknown as Response);
    render(<ChecklistVersaoPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir rascunho' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/atuacao/checklists'));
  });
});

describe('checklists no documento', () => {
  const cl = (itens: unknown[], comp = { total: 1, respondidos: 0, obrigatorios_pendentes: 1, bloqueiam_revisao: 1 }) => ({
    id: 'c-1', template_version_id: 'v-1', service: 'pgr', name: 'Modelo de teste', version_number: 1, versao_status: 'aprovado', itens, completude: comp,
  });
  const itemR = (over: Record<string, unknown> = {}) => ({ ...item({ blocks_review: true }), resposta: null, resposta_nota: null, answered_at: null, respondido_por: null, ...over });

  it('lista sem checklist e aplica um modelo aprovado', async () => {
    let aplicado = false;
    rotas['GET /documentos/d-1/checklists'] = () => resp(200, aplicado ? [cl([itemR()])] : []);
    rotas['GET /checklists/modelos'] = () => resp(200, [
      { id: 't-1', service: 'pgr', name: 'M1', versao_aprovada_id: 'v-1', versao_aprovada: 1, rascunho_id: null, ultima_versao: 1 },
      { id: 't-2', service: 'apr', name: 'Sem aprovação', versao_aprovada_id: null, versao_aprovada: null, rascunho_id: 'v-x', ultima_versao: 1 },
    ]);
    rotas['POST /documentos/d-1/checklists'] = () => { aplicado = true; return resp(201, [cl([itemR()])]); };
    render(<Checklists docId="d-1" encerrado={false} />);
    expect(await screen.findByText(/Nenhum checklist aplicado a este documento/)).toBeInTheDocument();
    const sel = screen.getByLabelText('Aplicar modelo aprovado');
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Selecione…', 'PGR — M1 (v1)']);
    fireEvent.change(sel, { target: { value: 'v-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText('1 obrigatório(s) pendente(s)')).toBeInTheDocument();
    expect(screen.getByText('1 bloqueia(m) o envio para revisão')).toBeInTheDocument();
    expect(JSON.parse((chamadas('POST')[0][1] as RequestInit).body as string)).toEqual({ template_version_id: 'v-1' });
  });

  it('responde um item e mostra a resposta devolvida; erro do servidor aparece como alerta', async () => {
    rotas['GET /documentos/d-1/checklists'] = () => resp(200, [cl([itemR()])]);
    rotas['GET /checklists/modelos'] = () => resp(200, []);
    const onMudou = vi.fn();
    rotas['PUT /documentos/d-1/checklists/c-1/itens/i-1'] = (init) => {
      const b = JSON.parse(init!.body as string);
      return b.value === 'sim'
        ? resp(200, [cl([itemR({ resposta: 'sim', resposta_nota: b.note ?? null, answered_at: '2026-11-01T12:00:00Z', respondido_por: 'Evelyn' })], { total: 1, respondidos: 1, obrigatorios_pendentes: 0, bloqueiam_revisao: 0 })])
        : resp(409, { message: 'Documento publicado ou cancelado não aceita alteração.' });
    };
    render(<Checklists docId="d-1" encerrado={false} onMudou={onMudou} />);
    const campo = await screen.findByLabelText(/Resposta \(Sim/);
    const salvar = screen.getByRole('button', { name: 'Salvar' });
    expect(salvar).toBeDisabled();
    fireEvent.change(campo, { target: { value: 'sim' } });
    fireEvent.change(screen.getByLabelText('Observação (opcional)'), { target: { value: 'ok' } });
    fireEvent.click(salvar);
    expect(await screen.findByText('Obrigatórios respondidos')).toBeInTheDocument();
    expect(screen.getByText(/Respondido por Evelyn/)).toBeInTheDocument();
    expect(onMudou).toHaveBeenCalled();
  });

  it('documento encerrado: sem aplicar nem salvar', async () => {
    rotas['GET /documentos/d-1/checklists'] = () => resp(200, [cl([itemR({ resposta: 'sim', answered_at: '2026-11-01T12:00:00Z', respondido_por: 'Evelyn' })])]);
    rotas['GET /checklists/modelos'] = () => resp(200, []);
    render(<Checklists docId="d-1" encerrado />);
    await screen.findByRole('list', { name: 'Itens de Modelo de teste' });
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.getByLabelText(/Resposta \(Sim/)).toBeDisabled();
  });

  it('sem permissão de leitura: mostra a mensagem do servidor e não quebra', async () => {
    rotas['GET /documentos/d-1/checklists'] = () => resp(403, { message: 'Sem a permissão checklists.read.' });
    rotas['GET /checklists/modelos'] = () => resp(403, { message: 'x' });
    render(<Checklists docId="d-1" encerrado={false} />);
    expect(await screen.findByText('Sem a permissão checklists.read.')).toBeInTheDocument();
  });
});
