import { describe, it, expect } from 'vitest';
import { EXTRA_MENU_ITEMS, MENU_ITEMS, itemAtivo } from '../menu';

describe('menu do dashboard', () => {
  it('"Relatório de visita técnica" fica logo depois de Documentos, no grupo principal', () => {
    const labels = MENU_ITEMS.map((i) => i.label);
    const iDocs = labels.indexOf('Documentos');
    expect(iDocs).toBeGreaterThanOrEqual(0);
    expect(labels[iDocs + 1]).toBe('Relatório de visita técnica');
  });
  it('mantém a rota existente (links antigos continuam válidos) e está implementado', () => {
    const item = MENU_ITEMS.find((i) => i.label === 'Relatório de visita técnica');
    expect(item?.href).toBe('/empresa/inspecoes');
    expect(item?.implemented).toBe(true);
  });
  it('não sobra o item antigo "Inspeções" nem duplicata da mesma rota', () => {
    expect(EXTRA_MENU_ITEMS.some((i) => i.label === 'Inspeções')).toBe(false);
    const hrefs = [...MENU_ITEMS, ...EXTRA_MENU_ITEMS].map((i) => i.href);
    expect(hrefs.filter((h) => h === '/empresa/inspecoes')).toHaveLength(1);
  });
});

const todos = [...MENU_ITEMS, ...EXTRA_MENU_ITEMS];

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
