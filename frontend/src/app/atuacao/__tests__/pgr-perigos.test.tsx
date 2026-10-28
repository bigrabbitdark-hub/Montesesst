import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(search),
}));

import PgrPage from '../pgr/page';
import PerigosPage from '../pgr/perigos/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const cliente = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: null,
  contact_name: null, contact_phone: null, status: 'active', situacao: 'ativa',
};
const cliente2 = { ...cliente, id: '22222222-2222-4222-8222-222222222222', name: 'Beta SA' };

const base = { tenant_id: null, description: null, esocial_code: null, default_assessment: null, active: true };
const gRuido = { ...base, id: 'h-1', scope: 'global', category: 'fisico', name: 'Ruído contínuo', description: 'Som acima do limite' };
const tAssedio = {
  ...base, id: 'h-2', scope: 'tenant', tenant_id: '11111111-1111-4111-8111-111111111111', category: 'psicossocial', name: 'Assédio moral',
};
const tInativo = { ...base, id: 'h-3', scope: 'tenant', tenant_id: '11111111-1111-4111-8111-111111111111', category: 'quimico', name: 'Poeira de sílica', active: false };
const detalhe = (r: typeof gRuido | typeof tAssedio, extra: Record<string, unknown> = {}) => ({
  ...r, sources: null, health_effects: null, exposure_routes: [], default_unit: null, tolerance_limit: null,
  tolerance_reference: null, suggested_controls: null, psychosocial: null, ...extra,
});

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0]).replace('/api/atuacao', '')}`);

function rota(over: Record<string, () => Response | Promise<Response>> = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url).replace('/api/atuacao', '')}`;
    for (const [k, f] of Object.entries(over)) if (chave.startsWith(k)) return f();
    if (chave.startsWith('GET /clientes')) return resp(200, [cliente, cliente2]);
    if (chave === 'GET /pgr/perigos/h-1') return resp(200, detalhe(gRuido));
    if (chave.startsWith('GET /pgr/perigos/h-2')) return resp(200, detalhe(tAssedio, { psychosocial: { jornada: 'Turnos longos' } }));
    if (chave.startsWith('GET /pgr/perigos')) return resp(200, [gRuido, tAssedio, tInativo]);
    if (chave.endsWith('/resumo')) return resp(200, { empresa: { id: '11111111-1111-4111-8111-111111111111', name: 'Alfa Ltda', trade_name: null, cnpj: '11222333000181' }, importados: {}, pendencias: ['cnae'], ghes: 2, riscos: 0, completude: 50 });
    return resp(404, {});
  });
}

beforeEach(() => {
  search = '';
  localStorage.clear();
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('menu', () => {
  it('tem o item PGR em /atuacao/pgr', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['PGR — Programa de Gerenciamento de Riscos', '/atuacao/pgr']);
  });
});

describe('visão geral do PGR', () => {
  it('mostra link da biblioteca, cartões em breve e links da empresa escolhida', async () => {
    rota();
    render(<PgrPage />);
    expect(screen.getByRole('link', { name: /Biblioteca de perigos/ })).toHaveAttribute('href', '/atuacao/pgr/perigos');
    for (const t of ['Matriz de riscos', 'Plano de ação', 'Emitir PGR', 'Integrações', 'Tabela 24']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Em breve').length).toBe(5);
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    expect(await screen.findByRole('link', { name: /Abrir Alfa Ltda/ })).toHaveAttribute('href', '/atuacao/empresas/11111111-1111-4111-8111-111111111111');
    expect(screen.getByRole('link', { name: /Biblioteca de perigos/ })).toHaveAttribute('href', '/atuacao/pgr/perigos?tenantId=11111111-1111-4111-8111-111111111111');
    await waitFor(() => expect(chamadas()).toContain('GET /pgr/empresas/11111111-1111-4111-8111-111111111111/resumo'));
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('403 no resumo cita a permissão Consultar o PGR', async () => {
    rota({ 'GET /pgr/empresas': () => resp(403, {}) });
    render(<PgrPage />);
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consultar o PGR');
  });
});

describe('visão geral: 404 do resumo', () => {
  it('diz "Empresa não encontrada."', async () => {
    rota({ 'GET /pgr/empresas': () => resp(404, {}) });
    render(<PgrPage />);
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Empresa não encontrada.');
  });
});

describe('biblioteca de perigos', () => {
  it('estado vazio explícito', async () => {
    rota({ 'GET /pgr/perigos': () => resp(200, []) });
    render(<PerigosPage />);
    expect(await screen.findByText('A biblioteca ainda não tem perigos. A carga inicial é fornecida pela equipe técnica.')).toBeInTheDocument();
  });

  it('403 explica a permissão pgr.read (Consultar o PGR)', async () => {
    rota({ 'GET /pgr/perigos': () => resp(403, {}) });
    render(<PerigosPage />);
    const al = await screen.findByRole('alert');
    expect(al).toHaveTextContent('Consultar o PGR');
    expect(al).toHaveTextContent('pgr.read');
  });

  it('lista com categoria, escopo e "não informado" para campos vazios', async () => {
    rota();
    render(<PerigosPage />);
    const item = (await screen.findByText('Ruído contínuo')).closest('li')!;
    expect(within(item).getByText('Físico')).toBeInTheDocument();
    expect(within(item).getByText('Global')).toBeInTheDocument();
    const outro = screen.getByText('Assédio moral').closest('li')!;
    expect(within(outro).getAllByText(/não informado/i).length).toBeGreaterThanOrEqual(2);
    expect(within(screen.getByText('Poeira de sílica').closest('li')!).getByText('Inativo')).toBeInTheDocument();
  });

  it('filtros de categoria e situação e a busca vão na query; escopo filtra no cliente', async () => {
    rota();
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'fisico' } });
    await waitFor(() => expect(chamadas().at(-1)).toContain('categoria=fisico'));
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'false' } });
    await waitFor(() => expect(chamadas().at(-1)).toContain('ativo=false'));
    fireEvent.change(screen.getByLabelText('Buscar perigo'), { target: { value: 'ruído' } });
    await waitFor(() => expect(decodeURIComponent(chamadas().at(-1)!)).toContain('q=ruído'));
    await screen.findByText('Ruído contínuo');
    fireEvent.change(screen.getByLabelText('Escopo'), { target: { value: 'global' } });
    expect(screen.queryByText('Assédio moral')).toBeNull();
    expect(screen.getByText('Ruído contínuo')).toBeInTheDocument();
  });

  it('paginação simples no cliente', async () => {
    const muitos = Array.from({ length: 25 }, (_, i) => ({ ...gRuido, id: `x-${i}`, name: `Perigo ${String(i).padStart(2, '0')}` }));
    rota({ 'GET /pgr/perigos': () => resp(200, muitos) });
    render(<PerigosPage />);
    await screen.findByText('Perigo 00');
    expect(screen.queryByText('Perigo 10')).toBeNull();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getByText('Perigo 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });

  it('sócio vê perigo global como somente leitura (sem editar nem inativar)', async () => {
    rota();
    render(<PerigosPage />);
    const item = (await screen.findByText('Ruído contínuo')).closest('li')!;
    expect(within(item).queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(within(item).queryByRole('button', { name: /Inativar/ })).toBeNull();
    fireEvent.click(within(item).getByRole('button', { name: /Ver detalhes de Ruído contínuo/ }));
    const form = await screen.findByRole('form', { name: /Perigo/ });
    expect(within(form).getByLabelText('Nome')).toBeDisabled();
    expect(within(form).queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(within(form).getByText(/somente leitura/i)).toBeInTheDocument();
  });

  it('sem empresa selecionada, "Novo perigo" fica desabilitado com dica', async () => {
    rota();
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    expect(screen.getByRole('button', { name: 'Novo perigo' })).toBeDisabled();
    expect(screen.getByText(/Selecione uma empresa para criar ou duplicar/)).toBeInTheDocument();
  });

  it('campos psicossociais aparecem somente na categoria psicossocial (com empresa selecionada)', async () => {
    search = 'tenantId=11111111-1111-4111-8111-111111111111';
    rota();
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo perigo' }));
    const form = await screen.findByRole('form', { name: /Novo perigo/ });
    for (const c of ['fisico', 'quimico', 'biologico', 'ergonomico', 'acidente']) {
      fireEvent.change(within(form).getByLabelText('Categoria do perigo'), { target: { value: c } });
      expect(within(form).queryByLabelText(/Violência e assédio/)).toBeNull();
    }
    fireEvent.change(within(form).getByLabelText('Categoria do perigo'), { target: { value: 'psicossocial' } });
    expect(within(form).getByLabelText(/Violência e assédio/)).toBeInTheDocument();
  });

  it('tenantId inválido na URL é ignorado (nenhuma requisição com ele)', async () => {
    search = 'tenantId=abc';
    rota();
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    expect(chamadas().some((c) => c.includes('tenantId'))).toBe(false);
  });

  it('nome vazio bloqueia o envio com alerta inline', async () => {
    search = 'tenantId=11111111-1111-4111-8111-111111111111';
    rota();
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo perigo' }));
    const form = await screen.findByRole('form', { name: /Novo perigo/ });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(await within(form).findByRole('alert')).toHaveTextContent('Informe o nome');
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('fechar o formulário devolve o foco ao botão de origem', async () => {
    rota();
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    const btn = within(item).getByRole('button', { name: /Editar Assédio moral/ });
    btn.focus();
    fireEvent.click(btn);
    const form = await screen.findByRole('form', { name: /Perigo/ });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(btn).toHaveFocus());
  });

  it('409 ao criar mostra a mensagem do servidor', async () => {
    search = 'tenantId=11111111-1111-4111-8111-111111111111';
    rota({ 'POST /pgr/perigos': () => resp(409, { message: 'Já existe um perigo com este nome nesta categoria e escopo.' }) });
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo perigo' }));
    const form = await screen.findByRole('form', { name: /Novo perigo/ });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Ruído contínuo' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Já existe um perigo com este nome');
  });

  it('409 ao duplicar mostra a mensagem do servidor', async () => {
    rota({ 'POST /pgr/perigos/h-2/duplicar': () => resp(409, { message: 'Já existe um perigo com este nome nesta categoria e escopo.' }) });
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Duplicar Assédio moral/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um perigo com este nome');
  });

  it('400 ao salvar mostra a mensagem do servidor', async () => {
    search = 'tenantId=11111111-1111-4111-8111-111111111111';
    rota({ 'POST /pgr/perigos': () => resp(400, { message: ['esocial_code deve ter no máximo 20 caracteres'] }) });
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo perigo' }));
    const form = await screen.findByRole('form', { name: /Novo perigo/ });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'X' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('esocial_code deve ter no máximo 20 caracteres');
  });

  it('404 ao abrir o detalhe diz "Perigo não encontrado."', async () => {
    rota({ 'GET /pgr/perigos/h-2': () => resp(404, {}) });
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Editar Assédio moral/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Perigo não encontrado.');
  });

  it('403 ao abrir o detalhe cita pgr.read', async () => {
    rota({ 'GET /pgr/perigos/h-2': () => resp(403, {}) });
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Editar Assédio moral/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pgr.read');
  });

  it('formulário de novo perigo: psicossocial condicional e envio com tenant_id', async () => {
    search = 'tenantId=11111111-1111-4111-8111-111111111111';
    rota({ 'POST /pgr/perigos': () => resp(201, { ...tAssedio, id: 'h-9' }) });
    render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo perigo' }));
    const form = await screen.findByRole('form', { name: /Novo perigo/ });
    expect(within(form).queryByLabelText(/Jornada/)).toBeNull();
    fireEvent.change(within(form).getByLabelText('Categoria do perigo'), { target: { value: 'psicossocial' } });
    for (const l of [/Organização do trabalho/, /Metas/, /Jornada/, /Relações interpessoais/, /Violência e assédio/]) {
      expect(within(form).getByLabelText(l)).toBeInTheDocument();
    }
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Pressão por metas' } });
    fireEvent.change(within(form).getByLabelText(/Metas/), { target: { value: 'Metas diárias' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(chamadas()).toContain('POST /pgr/perigos'));
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const corpo = JSON.parse((call[1] as RequestInit).body as string);
    expect(corpo).toMatchObject({ tenant_id: '11111111-1111-4111-8111-111111111111', category: 'psicossocial', name: 'Pressão por metas', psychosocial: { metas: 'Metas diárias' } });
    expect(await screen.findByRole('status')).toHaveTextContent('Perigo criado');
  });

  it('editar perigo da empresa carrega o detalhe e preenche campos psicossociais', async () => {
    rota();
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Editar Assédio moral/ }));
    const form = await screen.findByRole('form', { name: /Perigo/ });
    await waitFor(() => expect(within(form).getByLabelText(/Jornada/)).toHaveValue('Turnos longos'));
  });

  it('duplicar e inativar ficam desabilitados enquanto a chamada está em voo', async () => {
    let liberar!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { liberar = r; });
    rota({ 'POST /pgr/perigos/h-2/duplicar': () => lenta });
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Duplicar Assédio moral/ }));
    await waitFor(() => expect(within(item).getByRole('button', { name: /Duplicar Assédio moral/ })).toBeDisabled());
    expect(within(item).getByRole('button', { name: /Inativar Assédio moral/ })).toBeDisabled();
    liberar(resp(201, { ...tAssedio, id: 'h-8' }));
    expect(await screen.findByRole('status')).toHaveTextContent('duplicado');
    await waitFor(() => expect(within(screen.getByText('Assédio moral').closest('li')!).getByRole('button', { name: /Duplicar Assédio moral/ })).toBeEnabled());
  });

  it('inativar envia PATCH /ativo com active=false', async () => {
    rota({ 'PATCH /pgr/perigos/h-2/ativo': () => resp(200, { ...tAssedio, active: false }) });
    render(<PerigosPage />);
    const item = (await screen.findByText('Assédio moral')).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: /Inativar Assédio moral/ }));
    await waitFor(() => expect(chamadas()).toContain('PATCH /pgr/perigos/h-2/ativo'));
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ active: false });
  });

  it('ignora resposta obsoleta da lista', async () => {
    let liberarLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { liberarLenta = r; });
    let n = 0;
    rota({
      'GET /pgr/perigos': () => {
        n += 1;
        return n === 1 ? lenta : resp(200, [tAssedio]);
      },
    });
    render(<PerigosPage />);
    await waitFor(() => expect(n).toBe(1));
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'psicossocial' } });
    expect(await screen.findByText('Assédio moral')).toBeInTheDocument();
    liberarLenta(resp(200, [gRuido]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Ruído contínuo')).toBeNull();
  });

  it('401 limpa a sessão e redireciona para /login', async () => {
    const loc = { href: '/atuacao/pgr/perigos' };
    vi.stubGlobal('location', loc);
    fetchMock.mockResolvedValue(resp(401, {}));
    render(<PerigosPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
    expect(localStorage.getItem('montese_token')).toBeNull();
  });

  it('não usa as expressões proibidas', async () => {
    rota();
    const { container } = render(<PerigosPage />);
    await screen.findByText('Ruído contínuo');
    expect(container.textContent).not.toMatch(/assinatura digital|ICP-Brasil/i);
  });
});
