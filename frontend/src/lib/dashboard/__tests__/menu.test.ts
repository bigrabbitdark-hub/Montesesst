import { describe, it, expect } from 'vitest';
import { MENU_ITEMS, MENU_SETORES, itemAtivo } from '../menu';

const ESPERADO: { titulo: string | null; labels: string[] }[] = [
  { titulo: null, labels: ['Dashboard', 'Assistente Montese'] },
  { titulo: 'Empresa', labels: ['Empresas', 'Funcionários', 'Documentos', 'Relatório de visita técnica'] },
  { titulo: 'CIPA', labels: ['CIPA', 'Eleição da CIPA', 'Capacitação da CIPA'] },
  { titulo: 'Brigada e Incêndio', labels: ['Brigada de Incêndio', 'Equip. contra incêndio', 'Checklist prevenção', 'Simulados'] },
  { titulo: 'Segurança', labels: ['Mapa SST', 'EPIs', 'Consulta de CA'] },
  { titulo: 'Agenda', labels: ['Reuniões e Visitas'] },
  { titulo: 'Gestão', labels: ['Auditoria Montese', 'Auditoria IA', 'eSocial', 'Relatórios', 'Financeiro', 'Universidade', 'Configurações'] },
];

// Lista literal dos 24 hrefs: protege contra perda/alteração de rota.
const HREFS_ESPERADOS = [
  '/dashboard-v2',
  '/empresa/assistente',
  '/empresa/onboarding',
  '/empresa/em-construcao?item=Funcionários',
  '/empresa/documentos',
  '/empresa/inspecoes',
  '/empresa/cipa',
  '/empresa/cipa/eleicao',
  '/empresa/cipa/capacitacao',
  '/empresa/brigada',
  '/empresa/equipamentos-incendio',
  '/empresa/checklist-prevencao',
  '/empresa/simulados',
  '/empresa/mapa-sst',
  '/empresa/epis',
  '/empresa/consulta-ca',
  '/empresa/agendamentos',
  '/empresa/pente-fino',
  '/empresa/em-construcao?item=Auditoria IA',
  '/empresa/em-construcao?item=eSocial',
  '/empresa/em-construcao?item=Relatórios',
  '/empresa/em-construcao?item=Financeiro',
  '/empresa/em-construcao?item=Universidade',
  '/empresa/em-construcao?item=Configurações',
];

describe('menu do dashboard', () => {
  it('"Relatório de visita técnica" fica logo depois de Documentos, dentro do setor Empresa', () => {
    const setor = MENU_SETORES.find((s) => s.titulo === 'Empresa');
    expect(setor).toBeDefined();
    const labels = setor!.itens.map((i) => i.label);
    const iDocs = labels.indexOf('Documentos');
    expect(iDocs).toBeGreaterThanOrEqual(0);
    expect(labels[iDocs + 1]).toBe('Relatório de visita técnica');
    // e também na lista plana
    const planos = MENU_ITEMS.map((i) => i.label);
    expect(planos[planos.indexOf('Documentos') + 1]).toBe('Relatório de visita técnica');
  });
  it('mantém a rota existente (links antigos continuam válidos) e está implementado', () => {
    const item = MENU_ITEMS.find((i) => i.label === 'Relatório de visita técnica');
    expect(item?.href).toBe('/empresa/inspecoes');
    expect(item?.implemented).toBe(true);
  });
  it('não sobra o item antigo "Inspeções" nem duplicata da mesma rota', () => {
    expect(MENU_ITEMS.some((i) => i.label === 'Inspeções')).toBe(false);
    expect(MENU_ITEMS.filter((i) => i.href === '/empresa/inspecoes')).toHaveLength(1);
  });
});

describe('MENU_SETORES (agrupamento por setor)', () => {
  it('tem os setores, títulos e itens exatamente na ordem aprovada', () => {
    expect(MENU_SETORES.map((s) => ({ titulo: s.titulo, labels: s.itens.map((i) => i.label) }))).toEqual(ESPERADO);
  });
  it('só o primeiro setor (topo) não tem título; os demais têm título não vazio e único', () => {
    expect(MENU_SETORES[0].titulo).toBeNull();
    const titulos = MENU_SETORES.slice(1).map((s) => s.titulo);
    titulos.forEach((t) => expect(typeof t === 'string' && t.trim().length > 0).toBe(true));
    expect(new Set(titulos).size).toBe(titulos.length);
  });
  it('nenhum setor fica vazio', () => {
    MENU_SETORES.forEach((s) => expect(s.itens.length).toBeGreaterThan(0));
  });
  it('MENU_ITEMS é a lista plana dos setores: 24 itens, mesma ordem', () => {
    expect(MENU_ITEMS).toHaveLength(24);
    expect(MENU_ITEMS).toEqual(MENU_SETORES.flatMap((s) => s.itens));
  });
  it('hrefs e labels são únicos', () => {
    expect(new Set(MENU_ITEMS.map((i) => i.href)).size).toBe(MENU_ITEMS.length);
    expect(new Set(MENU_ITEMS.map((i) => i.label)).size).toBe(MENU_ITEMS.length);
  });
  it('o conjunto de hrefs é exatamente o esperado (nenhuma rota perdida ou alterada)', () => {
    expect(HREFS_ESPERADOS).toHaveLength(24);
    expect([...MENU_ITEMS.map((i) => i.href)].sort()).toEqual([...HREFS_ESPERADOS].sort());
  });
});

const todos = MENU_ITEMS;

describe('itemAtivo', () => {
  it('marca o item cujo href é igual ao caminho', () => {
    expect(itemAtivo('/empresa/documentos', todos)).toBe('/empresa/documentos');
    expect(itemAtivo('/dashboard-v2', todos)).toBe('/dashboard-v2');
  });
  it('subrota mantém o item pai ativo', () => {
    expect(itemAtivo('/empresa/cipa/membros', todos)).toBe('/empresa/cipa');
  });
  it('o href mais específico vence (Eleição não acende a Central da CIPA)', () => {
    expect(itemAtivo('/empresa/cipa/eleicao', todos)).toBe('/empresa/cipa/eleicao');
    expect(itemAtivo('/empresa/cipa/capacitacao', todos)).toBe('/empresa/cipa/capacitacao');
  });
  it('não confunde prefixos parecidos', () => {
    expect(itemAtivo('/empresa/epis-extra', todos)).toBeNull();
  });
  it('itens "em construção" (href com query) nunca ficam ativos e página desconhecida não ativa nada', () => {
    expect(itemAtivo('/empresa/em-construcao', todos)).toBeNull();
    expect(itemAtivo('/qualquer', todos)).toBeNull();
  });
});

describe('cobertura do menu (nenhuma página da empresa fica órfã)', () => {
  const hrefs = todos.map((i) => i.href.split('?')[0]);
  it.each([
    '/empresa/assistente', '/empresa/documentos', '/empresa/epis', '/empresa/consulta-ca', '/empresa/inspecoes',
    '/empresa/agendamentos', '/empresa/mapa-sst', '/empresa/pente-fino', '/empresa/equipamentos-incendio',
    '/empresa/brigada', '/empresa/checklist-prevencao', '/empresa/simulados', '/empresa/cipa',
    '/empresa/cipa/eleicao', '/empresa/cipa/capacitacao', '/empresa/onboarding',
  ])('%s está no menu novo', (href) => {
    expect(hrefs).toContain(href);
  });
});
