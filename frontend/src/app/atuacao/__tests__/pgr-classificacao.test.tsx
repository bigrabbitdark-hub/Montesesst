import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';

const T = '11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: T }),
  useSearchParams: () => new URLSearchParams(''),
}));

import FluxoPage from '../pgr/empresas/[tenantId]/page';

const G1 = '33333333-3333-4333-8333-333333333331';
const R1 = '66666666-6666-4666-8666-666666666661';
const M1 = '77777777-7777-4777-8777-777777777771';
const M2 = '77777777-7777-4777-8777-777777777772';

const resumo = {
  empresa: { id: T, name: 'Alfa Ltda', trade_name: null, cnpj: '11222333000181' },
  importados: { cnpj: true, cnae: true, grau_risco: null, endereco: true, unidades: 1, cargos: 2, funcionarios: 5 },
  pendencias: [], ghes: 1, riscos: 1, completude: 100,
};
const ghe1 = { id: G1, name: 'Soldagem', company_unit_id: null, positions: [], expostos: 3, riscos: 1 };
const risco = {
  id: R1, ghe_id: G1, hazard_id: null, category: 'fisico', name: 'Ruído contínuo', description: null, sources: null, health_effects: null,
  tolerance_limit: null, tolerance_reference: null, activity: null, exposure_type: null, esocial_code: null, assessment_type: null,
  assessment_notes: null, status: 'rascunho', controles: [], medicoes: [],
};
const niveis = [
  { id: 'n-a', rotulo: 'TESTE Nível A', aceitabilidade: 'TESTE aceitável', decisao: 'TESTE manter', bloqueia_emissao: false },
  { id: 'n-b', rotulo: 'TESTE Nível B', aceitabilidade: 'TESTE inaceitável', decisao: 'TESTE agir', bloqueia_emissao: true },
];
const config = {
  severidade: [{ valor: 1, rotulo: 'TESTE Sev baixa', descricao: 'TESTE descrição sev 1' }, { valor: 2, rotulo: 'TESTE Sev alta', descricao: 'TESTE descrição sev 2' }],
  probabilidade: [{ valor: 1, rotulo: 'TESTE Prob rara', descricao: 'TESTE descrição prob 1' }, { valor: 2, rotulo: 'TESTE Prob comum', descricao: 'TESTE descrição prob 2' }],
  niveis, faixas: [{ min: 1, max: 2, nivel_id: 'n-a' }, { min: 3, max: 4, nivel_id: 'n-b' }],
  metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE', data: '2026-10-01' },
};
const vigente = { id: M2, version_number: 2, status: 'publicada', config_sha256: 'x', notes: null, published_at: null, created_at: '2026-10-01', updated_at: '2026-10-01', config };
const aval = (over: Record<string, unknown> = {}) => ({
  id: 'a-1', risk_id: R1, kind: 'inerente', matrix_version_id: M2, matrix_version_number: 2, severity_value: 2, probability_value: 2, score: 4,
  level_id: 'n-b', nivel: niveis[1], justification: 'TESTE justificativa anterior',
  assessed_at: '2026-10-20T10:00:00.000Z', ...over,
});
const mapa = (over: Record<string, unknown> = {}) => ({
  kind: 'inerente', matrix_version: { id: M2, version_number: 2, status: 'publicada' },
  cells: [
    { severidade: 1, probabilidade: 1, score: 1, nivel_id: 'n-a', quantidade: 0 }, { severidade: 1, probabilidade: 2, score: 2, nivel_id: 'n-a', quantidade: 3 },
    { severidade: 2, probabilidade: 1, score: 2, nivel_id: 'n-a', quantidade: 0 }, { severidade: 2, probabilidade: 2, score: 4, nivel_id: 'n-b', quantidade: 5 },
  ],
  total_riscos: 14, classificados: 8, em_outra_versao: 2, sem_avaliacao: 4, por_versao: [{ version_number: 1, n: 2 }, { version_number: 2, n: 8 }], ...over,
});

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
const chave = (c: unknown[]) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0]).replace('/api/atuacao', '')}`;
const chamadas = () => fetchMock.mock.calls.map(chave);
const corpo = (prefixo: string) => {
  const c = fetchMock.mock.calls.find((x) => chave(x).startsWith(prefixo));
  return c ? JSON.parse(String((c[1] as RequestInit).body)) : undefined;
};
const AV = `/pgr/empresas/${T}/riscos/${R1}/avaliacoes`;

function rota(over: Record<string, () => Response | Promise<Response>> = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const k = `${init?.method ?? 'GET'} ${String(url).replace('/api/atuacao', '')}`;
    for (const [p, f] of Object.entries(over)) if (k.startsWith(p)) return f();
    if (k === `GET /pgr/empresas/${T}/resumo`) return resp(200, resumo);
    if (k === `GET /clientes/${T}`) return resp(200, { id: T, name: 'Alfa Ltda', responsaveis: [], units: [] });
    if (k === `GET /pgr/empresas/${T}/ghes`) return resp(200, [ghe1]);
    if (k === `GET /pgr/empresas/${T}/ghes/${G1}/riscos`) return resp(200, [risco]);
    if (k === 'GET /pgr/matriz/vigente') return resp(200, vigente);
    if (k === `GET ${AV}`) return resp(200, { historico: [], vigente: { inerente: null, residual_previsto: null } });
    if (k.startsWith('GET /pgr/perigos')) return resp(200, []);
    return resp(404, {});
  });
}

async function abrirEtapa(nome: RegExp) {
  await screen.findByRole('navigation', { name: 'Etapas do PGR' });
  fireEvent.click(screen.getByRole('button', { name: nome }));
}
async function abrirClassificacaoDoRisco() {
  render(<FluxoPage />);
  await abrirEtapa(/Riscos/);
  fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G1 } });
  fireEvent.click(await screen.findByRole('button', { name: 'Classificar risco Ruído contínuo' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('classificação do risco', () => {
  it('sem matriz publicada (404 do vigente): mostra espera, sem formulário, sem erro', async () => {
    rota({ 'GET /pgr/matriz/vigente': () => resp(404, { message: 'Nenhuma matriz publicada.' }) });
    await abrirClassificacaoDoRisco();
    expect(await screen.findByText('Aguardando matriz publicada pela equipe técnica.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salvar classificação/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('não classificado quando não há avaliação; mostra rótulo e descrição das escalas', async () => {
    rota();
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    expect(await r.findByText('Não classificado')).toBeInTheDocument();
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '2' } });
    expect(r.getByRole('option', { name: '2 — TESTE Sev alta' })).toBeInTheDocument();
    expect(r.getByText('TESTE descrição sev 2')).toBeInTheDocument();
  });

  it('classifica enviando só kind, versão, severidade, probabilidade e justificativa (sem score/nível) e mostra o resultado do servidor', async () => {
    rota({ [`POST ${AV}`]: () => resp(201, aval({ severity_value: 2, probability_value: 1, score: 2, level_id: 'n-a', nivel: niveis[0], id: 'a-9' })) });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '2' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: '  porque sim  ' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    await waitFor(() => expect(corpo('POST')).toBeDefined());
    expect(corpo('POST')).toEqual({ kind: 'inerente', matrix_version_id: M2, severity_value: 2, probability_value: 1, justification: 'porque sim' });
    expect(await r.findByText(/Escore: 2/)).toBeInTheDocument();
    expect(r.getAllByText(/TESTE Nível A/).length).toBeGreaterThan(0);
    expect(r.getByText(/TESTE aceitável/)).toBeInTheDocument();
    expect(r.getByText(/TESTE manter/)).toBeInTheDocument();
    expect(r.getAllByText(/versão 2/).length).toBeGreaterThan(0);
  });

  it('classifica o residual previsto com kind próprio', async () => {
    rota({ [`POST ${AV}`]: () => resp(201, aval({ kind: 'residual_previsto' })) });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco residual previsto' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'ok' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    await waitFor(() => expect(corpo('POST')?.kind).toBe('residual_previsto'));
  });

  it('exige seleção e justificativa (trim, máx. 4000) antes de enviar', async () => {
    rota();
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByText('Selecione a severidade e a probabilidade.')).toBeInTheDocument();
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: '   ' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByText('Informe a justificativa.')).toBeInTheDocument();
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'x'.repeat(4001) } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByText('A justificativa deve ter no máximo 4000 caracteres.')).toBeInTheDocument();
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('aviso explícito quando a última avaliação é de versão antiga', async () => {
    rota({
      [`GET ${AV}`]: () => resp(200, {
        historico: [aval({ matrix_version_id: M1, matrix_version_number: 1 })],
        vigente: { inerente: aval({ matrix_version_id: M1, matrix_version_number: 1 }), residual_previsto: null },
      }),
    });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    expect(await r.findByText('Avaliado na versão 1; a matriz vigente é a versão 2. Reavalie para classificar na versão atual.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Risco residual previsto' })).queryByText(/Avaliado na versão/)).toBeNull();
  });

  it('lista o histórico com versão, escore e nível, sem identificar o responsável', async () => {
    rota({
      [`GET ${AV}`]: () => resp(200, {
        historico: [aval(), aval({ id: 'a-0', matrix_version_number: 1, matrix_version_id: M1, severity_value: 1, probability_value: 1, score: 1, nivel: niveis[0], level_id: 'n-a', justification: 'TESTE antiga' })],
        vigente: { inerente: aval(), residual_previsto: null },
      }),
    });
    await abrirClassificacaoDoRisco();
    const h = within(await screen.findByRole('list', { name: 'Histórico de classificações' }));
    expect(h.getAllByRole('listitem')).toHaveLength(2);
    expect(h.getByText(/TESTE antiga/)).toBeInTheDocument();
    expect(h.getAllByText(/versão 1/).length).toBeGreaterThan(0);
    expect(h.queryByText(/responsável|abcdef12/)).toBeNull();
  });

  it('409 do servidor ao classificar (matriz sumiu) mostra a mensagem em alerta', async () => {
    rota({ [`POST ${AV}`]: () => resp(409, { message: 'Aguardando matriz publicada pela equipe técnica.' }) });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'ok' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByRole('alert')).toHaveTextContent('Aguardando matriz publicada pela equipe técnica.');
  });

  it('403 na leitura mostra "Consultar o PGR"; 403 ao salvar mostra "Elaborar o PGR"', async () => {
    rota({ [`GET ${AV}`]: () => resp(403, {}) });
    await abrirClassificacaoDoRisco();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Consultar o PGR/);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar classificação do risco Ruído contínuo' }));
    rota({ [`POST ${AV}`]: () => resp(403, {}) });
    fireEvent.click(screen.getByRole('button', { name: 'Classificar risco Ruído contínuo' }));
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'ok' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByRole('alert')).toHaveTextContent(/Elaborar o PGR/);
  });

  it('desabilita o formulário durante o envio e não duplica o POST', async () => {
    let liberar: (r: Response) => void = () => {};
    rota({ [`POST ${AV}`]: () => new Promise<Response>((res) => { liberar = res; }) });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'ok' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    const b = await r.findByRole('button', { name: 'Salvando…' });
    expect(b).toBeDisabled();
    expect(r.getByLabelText('Severidade')).toBeDisabled();
    expect(r.getByLabelText('Justificativa')).toBeDisabled();
    fireEvent.click(b);
    expect(chamadas().filter((c) => c.startsWith('POST'))).toHaveLength(1);
    await act(async () => { liberar(resp(201, aval())); });
    await r.findByText(/Escore: 4/);
  });
  it('versão arquivada (400): mostra a mensagem, recarrega a vigente, limpa escolhas, mantém a justificativa e permite salvar na nova versão', async () => {
    const M3 = '77777777-7777-4777-8777-777777777773';
    const v3 = { ...vigente, id: M3, version_number: 3, config: { ...config, severidade: [{ valor: 1, rotulo: 'TESTE Sev nova', descricao: 'TESTE d' }, config.severidade[1]] } };
    let vigentes = 0; let posts = 0;
    rota({
      'GET /pgr/matriz/vigente': () => resp(200, ++vigentes === 1 ? vigente : v3),
      [`POST ${AV}`]: () => (++posts === 1 ? resp(400, { message: 'A versão da matriz informada está arquivada; use a matriz vigente' }) : resp(201, aval({ matrix_version_id: M3, matrix_version_number: 3 }))),
    });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'minha justificativa' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByRole('alert')).toHaveTextContent('A versão da matriz informada está arquivada; use a matriz vigente');
    expect(await r.findByRole('option', { name: '1 — TESTE Sev nova' })).toBeInTheDocument();
    expect(vigentes).toBe(2);
    expect(r.getByLabelText('Severidade')).toHaveValue('');
    expect(r.getByLabelText('Probabilidade')).toHaveValue('');
    expect(r.getByLabelText('Justificativa')).toHaveValue('minha justificativa');
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
    fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '2' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    await waitFor(() => expect(posts).toBe(2));
    const ultimo = JSON.parse(String((fetchMock.mock.calls.filter((c) => chave(c).startsWith('POST')).at(-1)![1] as RequestInit).body));
    expect(ultimo.matrix_version_id).toBe(M3);
    expect(ultimo.justification).toBe('minha justificativa');
  });

  it('409 "A matriz vigente mudou" recarrega a vigente, mantém a justificativa e salva na nova versão', async () => {
    const M3 = '77777777-7777-4777-8777-777777777773';
    const v3 = { ...vigente, id: M3, version_number: 3 };
    let vigentes = 0; let posts = 0;
    rota({
      'GET /pgr/matriz/vigente': () => resp(200, ++vigentes === 1 ? vigente : v3),
      [`POST ${AV}`]: () => (++posts === 1 ? resp(409, { message: 'A matriz vigente mudou; recarregue e classifique novamente na versão atual' }) : resp(201, aval({ matrix_version_id: M3, matrix_version_number: 3 }))),
    });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    const preencher = () => {
      fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
      fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
    };
    preencher();
    fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'minha justificativa' } });
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByRole('alert')).toHaveTextContent('A matriz vigente mudou; recarregue');
    await waitFor(() => expect(vigentes).toBe(2));
    await waitFor(() => expect(r.getByLabelText('Severidade')).toHaveValue(''));
    expect(r.getByLabelText('Justificativa')).toHaveValue('minha justificativa');
    preencher();
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    await waitFor(() => expect(posts).toBe(2));
    const ultimo = JSON.parse(String((fetchMock.mock.calls.filter((c) => chave(c).startsWith('POST')).at(-1)![1] as RequestInit).body));
    expect(ultimo.matrix_version_id).toBe(M3);
  });

  it('403 ao classificar usa a mensagem própria e a confirmação some na próxima edição', async () => {
    let n = 0;
    rota({ [`POST ${AV}`]: () => (++n === 1 ? resp(201, aval()) : resp(403, {})) });
    await abrirClassificacaoDoRisco();
    const r = within(await screen.findByRole('region', { name: 'Risco inerente' }));
    await r.findByText('Não classificado');
    const preencher = () => {
      fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '1' } });
      fireEvent.change(r.getByLabelText('Probabilidade'), { target: { value: '1' } });
      fireEvent.change(r.getByLabelText('Justificativa'), { target: { value: 'ok' } });
    };
    preencher();
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByText('Classificação salva.')).toBeInTheDocument();
    fireEvent.change(r.getByLabelText('Severidade'), { target: { value: '2' } });
    expect(r.queryByText('Classificação salva.')).toBeNull();
    preencher();
    fireEvent.click(r.getByRole('button', { name: 'Salvar classificação' }));
    expect(await r.findByRole('alert')).toHaveTextContent("Você não tem a permissão 'Elaborar o PGR' (pgr.write) para classificar riscos.");
  });
});

describe('exclusão de risco com avaliações', () => {
  it('mostra a mensagem 409 do servidor', async () => {
    rota({ [`DELETE /pgr/empresas/${T}/riscos/${R1}`]: () => resp(409, { message: 'O risco possui avaliações; não pode ser excluído' }) });
    render(<FluxoPage />);
    await abrirEtapa(/Riscos/);
    fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G1 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir risco Ruído contínuo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão do risco' }));
    expect(await screen.findByText('O risco possui avaliações; não pode ser excluído')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir risco Ruído contínuo' })).toBeInTheDocument();
  });
});

describe('mapa de calor', () => {
  const MC = (k: string) => `GET /pgr/empresas/${T}/mapa-calor?kind=${k}&matrix_version_id=${M2}`;
  async function abrirMapa() {
    render(<FluxoPage />);
    await abrirEtapa(/Classificação/);
  }

  it('renderiza grade acessível com contagens, nível em texto, outra versão, por versão e sem avaliação', async () => {
    rota({ [MC('inerente')]: () => resp(200, mapa()) });
    await abrirMapa();
    const tab = await screen.findByRole('table', { name: /Mapa de calor/ });
    const t = within(tab);
    expect(t.getByRole('columnheader', { name: /TESTE Prob comum/ })).toHaveAttribute('scope', 'col');
    expect(t.getByRole('rowheader', { name: /TESTE Sev alta/ })).toHaveAttribute('scope', 'row');
    const celula = t.getByRole('cell', { name: /5 riscos.*TESTE Nível B/ });
    expect(celula).toBeInTheDocument();
    expect(t.getByRole('cell', { name: /3 riscos.*TESTE Nível A/ })).toBeInTheDocument();
    expect(t.getAllByRole('cell', { name: /^0 riscos.*TESTE Nível A/ })).toHaveLength(2);
    expect(screen.getByText(/4 riscos sem avaliação \(não classificados\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 riscos avaliados em outra versão da matriz/)).toBeInTheDocument();
    expect(screen.getByText('Versão 1: 2 riscos')).toBeInTheDocument();
    expect(screen.getByText('Versão 2: 8 riscos')).toBeInTheDocument();
    expect(screen.getByText(/TESTE inaceitável/)).toBeInTheDocument();
  });

  it('sem matriz publicada (404 / 409): mostra espera', async () => {
    rota({ 'GET /pgr/matriz/vigente': () => resp(404, { message: 'Nenhuma matriz publicada.' }) });
    await abrirMapa();
    expect(await screen.findByText('Aguardando matriz publicada pela equipe técnica.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('409 do mapa de calor mostra a mesma espera', async () => {
    rota({ [MC('inerente')]: () => resp(409, { message: 'Aguardando matriz publicada pela equipe técnica.' }) });
    await abrirMapa();
    expect(await screen.findByText('Aguardando matriz publicada pela equipe técnica.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('troca de tipo busca o residual e ignora resposta antiga (stale)', async () => {
    let liberarInerente: (r: Response) => void = () => {};
    rota({
      [MC('inerente')]: () => new Promise<Response>((res) => { liberarInerente = res; }),
      [MC('residual_previsto')]: () => resp(200, mapa({ kind: 'residual_previsto', sem_avaliacao: 9 })),
    });
    await abrirMapa();
    await waitFor(() => expect(chamadas()).toContain(MC('inerente')));
    fireEvent.change(await screen.findByLabelText('Tipo de risco'), { target: { value: 'residual_previsto' } });
    expect(await screen.findByText(/9 riscos sem avaliação/)).toBeInTheDocument();
    await act(async () => { liberarInerente(resp(200, mapa({ sem_avaliacao: 4 }))); });
    expect(screen.queryByText(/4 riscos sem avaliação/)).toBeNull();
    expect(screen.getByText(/9 riscos sem avaliação/)).toBeInTheDocument();
  });

  it('403 na leitura mostra "Consultar o PGR"', async () => {
    rota({ [MC('inerente')]: () => resp(403, {}) });
    await abrirMapa();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Consultar o PGR/);
  });
});
