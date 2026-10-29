import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const T = '11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: T }),
  useSearchParams: () => new URLSearchParams(''),
}));

import FluxoPage from '../pgr/empresas/[tenantId]/page';
import PgrPage from '../pgr/page';

const G1 = '33333333-3333-4333-8333-333333333331';
const G2 = '33333333-3333-4333-8333-333333333332';
const U1 = '44444444-4444-4444-8444-444444444441';
const H1 = '55555555-5555-4555-8555-555555555551';
const H2 = '55555555-5555-4555-8555-555555555552';
const R1 = '66666666-6666-4666-8666-666666666661';

const resumo = {
  empresa: { id: T, name: 'Alfa Ltda', trade_name: null, cnpj: '11222333000181' },
  importados: { cnpj: true, cnae: false, grau_risco: null, endereco: true, unidades: 1, cargos: 2, funcionarios: 5 },
  pendencias: ['cnae', 'ghes', 'riscos'], ghes: 0, riscos: 0, completude: 50,
};
const ficha = {
  id: T, name: 'Alfa Ltda', trade_name: null, cnpj: '11222333000181', status: 'active', situacao: 'ativa',
  responsaveis: [{ id: 'u-1', full_name: 'Dra. Sócia' }],
  units: [{ id: U1, name: 'Matriz SP', address_city: 'São Paulo', address_state: 'SP', status: 'ativo' }],
};
const ghe1 = { id: G1, name: 'Soldagem', company_unit_id: U1, positions: [{ id: 'p-1', name: 'Soldador' }], expostos: 3, riscos: 1 };
const ghe2 = { id: G2, name: 'Escritório', company_unit_id: null, positions: [], expostos: 0, riscos: 0 };
const hz1 = { id: H1, scope: 'global', tenant_id: null, category: 'fisico', name: 'Ruído contínuo', description: null, esocial_code: null, default_assessment: null, active: true };
const hz2 = { ...hz1, id: H2, category: 'quimico', name: 'Poeira de sílica' };
const epi = { id: 'e-1', category: 'Mãos', code: 'L1', equipment_group: 'Luvas', description: 'Luva de couro', risk_protected: null, related_nr: null };
const risco = (over: Record<string, unknown> = {}) => ({
  id: R1, ghe_id: G1, hazard_id: H1, category: 'fisico', name: 'Ruído contínuo', description: null, sources: null, health_effects: null,
  tolerance_limit: null, tolerance_reference: null, activity: null, exposure_type: null, esocial_code: null, assessment_type: null,
  assessment_notes: null, status: 'rascunho', controles: [], medicoes: [], ...over,
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

function rota(over: Record<string, () => Response | Promise<Response>> = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const k = `${init?.method ?? 'GET'} ${String(url).replace('/api/atuacao', '')}`;
    for (const [p, f] of Object.entries(over)) if (k.startsWith(p)) return f();
    if (k === `GET /pgr/empresas/${T}/resumo`) return resp(200, resumo);
    if (k === `GET /clientes/${T}`) return resp(200, ficha);
    if (k === `GET /pgr/empresas/${T}/ghes`) return resp(200, [ghe1, ghe2]);
    if (k === `GET /pgr/empresas/${T}/ghes/${G1}/riscos`) return resp(200, [risco()]);
    if (k === `GET /pgr/empresas/${T}/ghes/${G2}/riscos`) return resp(200, []);
    if (k === `GET /pgr/empresas/${T}/cargos`) return resp(200, [{ id: 'p-1', name: 'Soldador' }, { id: 'p-2', name: 'Ajudante' }]);
    if (k.startsWith('GET /pgr/epi-catalogo')) return resp(200, [epi]);
    if (k.startsWith('GET /pgr/perigos')) return resp(200, [hz1, hz2]);
    return resp(404, {});
  });
}

async function abrirEtapa(nome: RegExp) {
  await screen.findByRole('navigation', { name: 'Etapas do PGR' });
  fireEvent.click(screen.getByRole('button', { name: nome }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('etapas e progresso', () => {
  it('mostra 5 etapas, progresso, pendências em pt-BR e cartões em breve', async () => {
    rota();
    render(<FluxoPage />);
    const nav = await screen.findByRole('navigation', { name: 'Etapas do PGR' });
    for (const n of ['Empresa', 'Responsáveis', 'Ambientes', 'Riscos', 'Classificação']) expect(within(nav).getByRole('button', { name: new RegExp(n) })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Completude do inventário' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/Pendências: CNAE, GHEs, Riscos/)).toBeInTheDocument();
    for (const t of ['Plano de ação', 'Emitir PGR']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getAllByText('Em breve').length).toBe(2);
    expect(document.body.textContent).not.toMatch(/ICP-Brasil|assinatura digital/i);
  });

  it('etapa Empresa: importado, faltante, grau de risco indisponível e link para corrigir', async () => {
    rota();
    render(<FluxoPage />);
    await screen.findByText('Alfa Ltda');
    const linha = (re: RegExp) => screen.getAllByRole('listitem').find((li) => re.test(li.textContent ?? ''));
    expect(linha(/^CNPJ — Importado$/)).toBeTruthy();
    expect(linha(/^CNAE — Faltando$/)).toBeTruthy();
    expect(linha(/^Grau de risco — indisponível no cadastro/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Corrigir no cadastro/ })).toHaveAttribute('href', `/atuacao/clientes/${T}`);
  });

  it('navega entre etapas marcando a etapa atual', async () => {
    rota();
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    expect(screen.getByRole('button', { name: /Ambientes/ })).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText('Soldagem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Riscos/ }));
    expect(await screen.findByLabelText('Ambiente (GHE)')).toBeInTheDocument();
  });

  it('empresa inexistente (404): mensagem clara e sem etapas', async () => {
    rota({ [`GET /pgr/empresas/${T}/resumo`]: () => resp(404, {}) });
    render(<FluxoPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Empresa não encontrada.');
    expect(screen.queryByRole('navigation', { name: 'Etapas do PGR' })).toBeNull();
  });
});

describe('Responsáveis', () => {
  it('sem API de registros ao sócio: texto de indisponível, nada inventado, representante só local', async () => {
    rota();
    render(<FluxoPage />);
    await abrirEtapa(/Responsáveis/);
    expect(await screen.findByText('Dra. Sócia')).toBeInTheDocument();
    expect(screen.getByText('Registro profissional não cadastrado ou indisponível para consulta')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/CREA|ART\b/);
    const rep = screen.getByLabelText('Representante da empresa');
    fireEvent.change(rep, { target: { value: 'Maria' } });
    expect(screen.getByText(/não é salvo/i)).toBeInTheDocument();
    expect(chamadas().filter((c) => !c.startsWith('GET'))).toEqual([]);
  });
});

describe('Ambientes', () => {
  it('lista GHE com número de expostos, sem nomes, e unidade pelo nome', async () => {
    rota();
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    const card = (await screen.findByText('Soldagem')).closest('li') as HTMLElement;
    expect(within(card).getByText('3 funcionários expostos')).toBeInTheDocument();
    expect(within(card).getByText(/Matriz SP/)).toBeInTheDocument();
    expect(within(card).getByText('Soldador')).toBeInTheDocument();
    expect(chamadas().some((c) => c.includes('/funcionarios'))).toBe(false);
  });

  it('cria GHE só com o campo informado e sem tenant_id no corpo; atualiza a lista e o resumo', async () => {
    const criado = { id: 'g-new', name: 'Almoxarifado', company_unit_id: null, positions: [], expostos: 0, riscos: 0 };
    let lista = [ghe1, ghe2];
    rota({
      [`POST /pgr/empresas/${T}/ghes`]: () => { lista = [...lista, criado]; return resp(201, criado); },
      [`GET /pgr/empresas/${T}/ghes`]: () => resp(200, lista),
    });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Soldagem');
    fireEvent.click(screen.getByRole('button', { name: 'Novo ambiente (GHE)' }));
    fireEvent.change(screen.getByLabelText('Nome do GHE'), { target: { value: 'Almoxarifado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar GHE' }));
    expect(await screen.findByText('Almoxarifado')).toBeInTheDocument();
    expect(corpo('POST ')).toEqual({ name: 'Almoxarifado' });
    expect(chamadas().filter((c) => c === `GET /pgr/empresas/${T}/resumo`).length).toBeGreaterThan(1);
  });

  it('nome vazio não chama a API; erro do servidor (400) é exibido', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes`]: () => resp(400, { message: ['name deve ter no máximo 200 caracteres'] }) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Soldagem');
    fireEvent.click(screen.getByRole('button', { name: 'Novo ambiente (GHE)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar GHE' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o nome do GHE.');
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Nome do GHE'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar GHE' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('name deve ter no máximo 200 caracteres'));
  });

  it('remove um cargo do GHE via PUT cargos com os ids restantes', async () => {
    const dois = { ...ghe1, positions: [{ id: 'p-1', name: 'Soldador' }, { id: 'p-2', name: 'Ajudante' }] };
    rota({
      [`GET /pgr/empresas/${T}/ghes`]: () => resp(200, [dois]),
      [`PUT /pgr/empresas/${T}/ghes/${G1}/cargos`]: () => resp(200, ghe1),
    });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Ajudante');
    fireEvent.click(screen.getByRole('button', { name: 'Remover cargo Ajudante do GHE Soldagem' }));
    await waitFor(() => expect(corpo('PUT ')).toEqual({ position_ids: ['p-1'] }));
  });

  it('exclusão de GHE com riscos mostra a mensagem 409 do servidor', async () => {
    rota({ [`DELETE /pgr/empresas/${T}/ghes/${G1}`]: () => resp(409, { message: 'O GHE possui riscos; remova-os antes de excluir' }) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Soldagem');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir GHE Soldagem' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }));
    expect(await screen.findByText('O GHE possui riscos; remova-os antes de excluir')).toBeInTheDocument();
  });
});

describe('Riscos', () => {
  async function irParaRiscos() {
    render(<FluxoPage />);
    await abrirEtapa(/Riscos/);
    fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G1 } });
    await screen.findByText('Ruído contínuo');
  }

  it('mostra "não informado" para exposição e avaliação nulas', async () => {
    rota();
    await irParaRiscos();
    const card = screen.getByRole('article', { name: 'Risco: Ruído contínuo' });
    expect(within(card).getByText(/Exposição: não informado/)).toBeInTheDocument();
    expect(within(card).getByText(/Avaliação: não informado/)).toBeInTheDocument();
  });

  it('adiciona vários perigos de uma vez e mostra os ignorados', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(201, { riscos: [risco({ id: 'r-2', hazard_id: H2, name: 'Poeira de sílica' })], ignorados: [H1] }) });
    await irParaRiscos();
    fireEvent.click(screen.getByLabelText('Ruído contínuo (Físico)'));
    fireEvent.click(screen.getByLabelText('Poeira de sílica (Químico)'));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao GHE (2)' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/1 risco adicionado[\s\S]*1 já estava no GHE: Ruído contínuo/);
    expect(corpo('POST ')).toEqual({ hazard_ids: [H1, H2] });
  });

  it('biblioteca vazia mostra a mesma mensagem explícita', async () => {
    rota({ 'GET /pgr/perigos': () => resp(200, []) });
    await irParaRiscos();
    expect(screen.getByText('A biblioteca ainda não tem perigos. A carga inicial é fornecida pela equipe técnica.')).toBeInTheDocument();
  });

  it('campos de medição só aparecem quando a avaliação é quantitativa', async () => {
    rota();
    await irParaRiscos();
    expect(screen.queryByRole('button', { name: 'Adicionar medição' })).toBeNull();
    expect(screen.getByText(/Medições só se aplicam a avaliação quantitativa/)).toBeInTheDocument();
  });

  it('com avaliação quantitativa permite registrar medição com valor/unidade como texto livre', async () => {
    const q = risco({ assessment_type: 'quantitativa' });
    rota({
      [`GET /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(200, [q]),
      [`POST /pgr/empresas/${T}/riscos/${R1}/medicoes`]: () => resp(201, { id: 'm-1', agent: 'Ruído', value: '87,5', unit: 'dB(A)', tolerance_limit: null, reference: null, methodology: null, equipment: null, evaluated_on: null }),
    });
    await irParaRiscos();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar medição' }));
    fireEvent.change(screen.getByLabelText('Agente medido'), { target: { value: 'Ruído' } });
    fireEvent.change(screen.getByLabelText('Valor medido'), { target: { value: '87,5' } });
    fireEvent.change(screen.getByLabelText('Unidade da medição'), { target: { value: 'dB(A)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar medição' }));
    expect(await screen.findByText(/87,5 dB\(A\)/)).toBeInTheDocument();
    expect(corpo('POST ')).toEqual({ agent: 'Ruído', value: '87,5', unit: 'dB(A)' });
  });

  it('editar a cópia envia só os campos alterados e mostra erro do servidor ao marcar completo', async () => {
    rota({ [`PATCH /pgr/empresas/${T}/riscos/${R1}`]: () => resp(400, { message: 'Para marcar o risco como completo, informe o tipo de exposição e o tipo de avaliação' }) });
    await irParaRiscos();
    fireEvent.click(screen.getByRole('button', { name: 'Editar risco Ruído contínuo' }));
    fireEvent.change(screen.getByLabelText('Situação do risco'), { target: { value: 'completo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar risco' }));
    expect(await screen.findByText(/Para marcar o risco como completo, informe o tipo de exposição/)).toBeInTheDocument();
    expect(corpo('PATCH ')).toEqual({ status: 'completo' });
  });

  it('controle exige situação (sem padrão) e treinamento usa o vocabulário de tipos', async () => {
    rota({ [`POST /pgr/empresas/${T}/riscos/${R1}/controles`]: () => resp(201, { id: 'c-1', kind: 'treinamento', description: 'Treino em altura', status: 'planejado', effectiveness: null, epi_catalog_item_id: null, training_tipo: 'nr-35' }) });
    await irParaRiscos();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar controle' }));
    fireEvent.change(screen.getByLabelText('Tipo de controle'), { target: { value: 'treinamento' } });
    fireEvent.change(screen.getByLabelText('Descrição do controle'), { target: { value: 'Treino em altura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe a situação do controle.');
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Situação do controle'), { target: { value: 'planejado' } });
    fireEvent.change(screen.getByLabelText('Treinamento'), { target: { value: 'nr-35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
    expect(await screen.findByText('Treino em altura', { selector: 'span' })).toBeInTheDocument();
    expect(corpo('POST ')).toEqual({ kind: 'treinamento', description: 'Treino em altura', status: 'planejado', training_tipo: 'nr-35' });
  });

  it('copiar riscos de outro GHE só chama a API depois da confirmação', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes/${G2}/copiar-riscos`]: () => resp(201, { riscos: [risco({ id: 'r-9', ghe_id: G2 })], ignorados: [] }) });
    render(<FluxoPage />);
    await abrirEtapa(/Riscos/);
    fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G2 } });
    await waitFor(() => expect(screen.getByLabelText('Copiar riscos de')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Copiar riscos de'), { target: { value: G1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar riscos' }));
    expect(screen.getByText(/Copiar os riscos e controles de Soldagem para Escritório/)).toBeInTheDocument();
    expect(chamadas().some((c) => c.startsWith('POST'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cópia' }));
    await waitFor(() => expect(corpo('POST ')).toEqual({ from_ghe_id: G1 }));
    expect(await screen.findByRole('status')).toHaveTextContent(/1 risco copiado/);
  });
});

describe('visão geral do PGR', () => {
  it('liga ao fluxo guiado da empresa escolhida', async () => {
    rota({ 'GET /clientes': () => resp(200, [{ id: T, name: 'Alfa Ltda', trade_name: null, cnpj: '1', sector: null, contact_name: null, contact_phone: null, status: 'active', situacao: 'ativa' }]) });
    render(<PgrPage />);
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: T } });
    expect(await screen.findByRole('link', { name: /Montar inventário/ })).toHaveAttribute('href', `/atuacao/pgr/empresas/${T}`);
  });
});


const semTenantNemEscopo = (prefixo: string) => expect(JSON.stringify(corpo(prefixo))).not.toMatch(/tenant_id|scope/);

describe('rodada de correção 1', () => {
  async function riscosG1() {
    render(<FluxoPage />);
    await abrirEtapa(/Riscos/);
    fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G1 } });
    await screen.findByText('Ruído contínuo');
  }

  it('vincula cargos escolhidos da lista da empresa (PUT com o conjunto completo)', async () => {
    rota({ [`PUT /pgr/empresas/${T}/ghes/${G2}/cargos`]: () => resp(200, { ...ghe2, positions: [{ id: 'p-1', name: 'Soldador' }, { id: 'p-2', name: 'Ajudante' }] }) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Escritório');
    fireEvent.click(screen.getByRole('button', { name: 'Vincular cargos ao GHE Escritório' }));
    fireEvent.click(await screen.findByLabelText('Soldador'));
    fireEvent.click(screen.getByLabelText('Ajudante'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cargos' }));
    await waitFor(() => expect(corpo('PUT ')).toEqual({ position_ids: ['p-1', 'p-2'] }));
    expect(await screen.findByRole('status')).toHaveTextContent('Cargos do GHE "Escritório" atualizados.');
  });

  it('empresa sem cargos: mensagem e link para o cadastro; erro da lista é exibido', async () => {
    rota({ [`GET /pgr/empresas/${T}/cargos`]: () => resp(200, []) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Escritório');
    fireEvent.click(screen.getByRole('button', { name: 'Vincular cargos ao GHE Escritório' }));
    expect(await screen.findByText(/A empresa ainda não tem cargos cadastrados\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cadastro do cliente/ })).toHaveAttribute('href', `/atuacao/clientes/${T}`);
  });

  it('erro ao carregar cargos aparece no seletor', async () => {
    rota({ [`GET /pgr/empresas/${T}/cargos`]: () => resp(403, {}) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Escritório');
    fireEvent.click(screen.getByRole('button', { name: 'Vincular cargos ao GHE Escritório' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("permissão 'Consultar o PGR'");
  });

  it('controle EPI: escolhe item do catálogo e envia epi_catalog_item_id (sem CA)', async () => {
    rota({ [`POST /pgr/empresas/${T}/riscos/${R1}/controles`]: () => resp(201, { id: 'c-2', kind: 'epi', description: 'Luva de couro', status: 'existente', effectiveness: null, epi_catalog_item_id: 'e-1', training_tipo: null }) });
    await riscosG1();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar controle' }));
    fireEvent.change(screen.getByLabelText('Tipo de controle'), { target: { value: 'epi' } });
    fireEvent.change(screen.getByLabelText('Buscar EPI no catálogo'), { target: { value: 'luva' } });
    await waitFor(() => expect(chamadas().some((c) => c.includes('/pgr/epi-catalogo?q=luva'))).toBe(true));
    fireEvent.click(await screen.findByLabelText(/Luva de couro/));
    fireEvent.change(screen.getByLabelText('Situação do controle'), { target: { value: 'existente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
    await waitFor(() => expect(corpo('POST ')).toEqual({ kind: 'epi', description: 'Luva de couro', status: 'existente', epi_catalog_item_id: 'e-1' }));
    expect(document.body.textContent).not.toMatch(/\bCA\b|validade/i);
    semTenantNemEscopo('POST ');
  });

  it('controle EPI com id inexistente (400) mostra a mensagem do servidor', async () => {
    rota({ [`POST /pgr/empresas/${T}/riscos/${R1}/controles`]: () => resp(400, { message: 'EPI não encontrado no catálogo' }) });
    await riscosG1();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar controle' }));
    fireEvent.change(screen.getByLabelText('Tipo de controle'), { target: { value: 'epi' } });
    fireEvent.click(await screen.findByLabelText(/Luva de couro/));
    fireEvent.change(screen.getByLabelText('Situação do controle'), { target: { value: 'existente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
    expect(await screen.findByText('EPI não encontrado no catálogo')).toBeInTheDocument();
  });

  it('mais de 100 perigos selecionados: envio desabilitado com aviso', async () => {
    const muitos = Array.from({ length: 101 }, (_, i) => ({ ...hz1, id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`, name: `Perigo ${i}` }));
    rota({ 'GET /pgr/perigos': () => resp(200, muitos) });
    await riscosG1();
    for (let i = 0; i < 101; i++) fireEvent.click(screen.getByLabelText(`Perigo ${i} (Físico)`));
    expect(screen.getByRole('button', { name: 'Adicionar ao GHE (101)' })).toBeDisabled();
    expect(screen.getByText(/Máximo de 100 perigos por vez/)).toBeInTheDocument();
  });

  it('seleção só é limpa quando a adição dá certo', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(400, { message: 'Há perigos inexistentes, inativos ou indisponíveis para esta empresa' }) });
    await riscosG1();
    fireEvent.click(screen.getByLabelText('Ruído contínuo (Físico)'));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao GHE (1)' }));
    expect(await screen.findByText(/perigos inexistentes, inativos/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ruído contínuo (Físico)')).toBeChecked();
  });

  it('adiciona risco com exposure_type escolhido e sem tenant_id/scope no corpo', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(201, { riscos: [], ignorados: [] }) });
    await riscosG1();
    fireEvent.change(screen.getByLabelText('Exposição dos riscos adicionados'), { target: { value: 'intermitente' } });
    fireEvent.click(screen.getByLabelText('Poeira de sílica (Químico)'));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao GHE (1)' }));
    await waitFor(() => expect(corpo('POST ')).toEqual({ hazard_ids: [H2], exposure_type: 'intermitente' }));
    semTenantNemEscopo('POST ');
  });

  it('limpar a exposição envia exposure_type null', async () => {
    rota({
      [`GET /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(200, [risco({ exposure_type: 'eventual' })]),
      [`PATCH /pgr/empresas/${T}/riscos/${R1}`]: () => resp(200, risco()),
    });
    await riscosG1();
    fireEvent.click(screen.getByRole('button', { name: 'Editar risco Ruído contínuo' }));
    fireEvent.change(screen.getByLabelText('Tipo de exposição'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar risco' }));
    await waitFor(() => expect(corpo('PATCH ')).toEqual({ exposure_type: null }));
  });

  it('403 na escrita mostra a mensagem de permissão pgr.write', async () => {
    rota({ [`POST /pgr/empresas/${T}/ghes`]: () => resp(403, {}) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Soldagem');
    fireEvent.click(screen.getByRole('button', { name: 'Novo ambiente (GHE)' }));
    fireEvent.change(screen.getByLabelText('Nome do GHE'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar GHE' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("permissão 'Elaborar o PGR' (pgr.write)");
    semTenantNemEscopo('POST ');
  });

  it('botão fica desabilitado enquanto a requisição está em andamento', async () => {
    let liberar: (r: Response) => void = () => {};
    rota({ [`POST /pgr/empresas/${T}/ghes`]: () => new Promise<Response>((res) => { liberar = res; }) });
    render(<FluxoPage />);
    await abrirEtapa(/Ambientes/);
    await screen.findByText('Soldagem');
    fireEvent.click(screen.getByRole('button', { name: 'Novo ambiente (GHE)' }));
    fireEvent.change(screen.getByLabelText('Nome do GHE'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar GHE' }));
    expect(await screen.findByRole('button', { name: 'Salvando…' })).toBeDisabled();
    liberar(resp(201, { id: 'g-x', name: 'X', company_unit_id: null, positions: [], expostos: 0, riscos: 0 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvando…' })).toBeNull());
  });

  it('401 limpa a sessão e vai para /login', async () => {
    const loc = { href: `/atuacao/pgr/empresas/${T}` };
    vi.stubGlobal('location', loc);
    fetchMock.mockResolvedValue(resp(401, {}));
    render(<FluxoPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
    expect(localStorage.getItem('montese_token')).toBeNull();
  });

  it('404 de GHE usa a mensagem do servidor, sem rotular como empresa', async () => {
    rota({ [`GET /pgr/empresas/${T}/ghes/${G1}/riscos`]: () => resp(404, { message: 'GHE não encontrado' }) });
    render(<FluxoPage />);
    await abrirEtapa(/Riscos/);
    fireEvent.change(await screen.findByLabelText('Ambiente (GHE)'), { target: { value: G1 } });
    expect(await screen.findByRole('alert')).toHaveTextContent('GHE não encontrado');
  });

  it('Responsáveis: distingue carregando de falha na ficha', async () => {
    rota({ [`GET /clientes/${T}`]: () => resp(403, {}) });
    render(<FluxoPage />);
    await abrirEtapa(/Responsáveis/);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar os responsáveis/);
    expect(screen.getByRole('heading', { name: 'Responsáveis pelo cliente' })).toBeInTheDocument();
  });
});
