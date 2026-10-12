import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

let pathname = '/empresa/cipa/membros';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
const logout = vi.fn();
vi.mock('@/lib/auth', () => ({ logout: () => logout(), getToken: () => null }));

import { DashboardSidebar } from '../DashboardSidebar';

beforeEach(() => {
  pathname = '/empresa/cipa/membros';
  logout.mockClear();
});

describe('DashboardSidebar', () => {
  it('em subrota, só a Central da CIPA fica com aria-current', () => {
    render(<DashboardSidebar />);
    const atual = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(atual).toHaveLength(1);
    expect(atual[0]).toHaveTextContent('CIPA');
  });
  it('lista Eleição e Capacitação da CIPA', () => {
    render(<DashboardSidebar />);
    expect(screen.getByRole('link', { name: /Eleição/ })).toHaveAttribute('href', '/empresa/cipa/eleicao');
    expect(screen.getByRole('link', { name: /Capacitação/ })).toHaveAttribute('href', '/empresa/cipa/capacitacao');
  });
  it('rola a lista até o item ativo (fica visível em telas baixas)', () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    render(<DashboardSidebar />);
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar.mock.instances[0]).toHaveTextContent('CIPA');
  });
  it('tem botão Sair que chama logout', () => {
    render(<DashboardSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

const SETORES = [
  { titulo: 'Empresa', links: [
    ['Empresas', '/empresa/onboarding'],
    ['Funcionários', '/empresa/em-construcao?item=Funcionários'],
    ['Documentos', '/empresa/documentos'],
    ['Relatório de visita técnica', '/empresa/inspecoes'],
  ] },
  { titulo: 'CIPA', links: [
    ['CIPA', '/empresa/cipa'],
    ['Eleição da CIPA', '/empresa/cipa/eleicao'],
    ['Capacitação da CIPA', '/empresa/cipa/capacitacao'],
  ] },
  { titulo: 'Brigada e Incêndio', links: [
    ['Brigada de Incêndio', '/empresa/brigada'],
    ['Equip. contra incêndio', '/empresa/equipamentos-incendio'],
    ['Checklist prevenção', '/empresa/checklist-prevencao'],
    ['Simulados', '/empresa/simulados'],
  ] },
  { titulo: 'Segurança', links: [
    ['Mapa SST', '/empresa/mapa-sst'],
    ['EPIs', '/empresa/epis'],
    ['Consulta de CA', '/empresa/consulta-ca'],
  ] },
  { titulo: 'Agenda', links: [
    ['Reuniões e Visitas', '/empresa/agendamentos'],
  ] },
  { titulo: 'Gestão', links: [
    ['Auditoria Montese', '/empresa/pente-fino'],
    ['Auditoria IA', '/empresa/em-construcao?item=Auditoria IA'],
    ['eSocial', '/empresa/em-construcao?item=eSocial'],
    ['Relatórios', '/empresa/em-construcao?item=Relatórios'],
    ['Financeiro', '/empresa/em-construcao?item=Financeiro'],
    ['Universidade', '/empresa/em-construcao?item=Universidade'],
    ['Configurações', '/empresa/em-construcao?item=Configurações'],
  ] },
] as const;

function atuais() {
  return screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
}

describe('DashboardSidebar da empresa agrupada por setores', () => {
  it('Dashboard e Assistente Montese vêm antes de qualquer título de setor, fora de qualquer setor', () => {
    render(<DashboardSidebar />);
    const primeiroTitulo = screen.getAllByRole('heading')[0];
    const dash = screen.getByRole('link', { name: 'Dashboard' });
    const assistente = screen.getByRole('link', { name: 'Assistente Montese' });
    expect(dash).toHaveAttribute('href', '/dashboard-v2');
    expect(assistente).toHaveAttribute('href', '/empresa/assistente');
    for (const a of [dash, assistente]) {
      expect(a.compareDocumentPosition(primeiroTitulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(a.closest('ul[aria-labelledby]')).toBeNull();
    }
    expect(dash.compareDocumentPosition(assistente) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mostra os 6 títulos de setor, como headings, na ordem aprovada', () => {
    render(<DashboardSidebar />);
    const titulos = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(titulos).toEqual(SETORES.map((s) => s.titulo));
    expect(screen.queryByText('Mais ferramentas')).toBeNull();
  });

  it.each(SETORES.map((s) => [s.titulo, s.links] as const))('o setor %s é uma lista com nome acessível e os links esperados, em ordem', (titulo, links) => {
    render(<DashboardSidebar />);
    const lista = screen.getByRole('list', { name: titulo });
    const encontrados = within(lista).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(encontrados).toEqual(links.map(([l, h]) => [l, h]));
  });

  it('os 24 links estão presentes, com os hrefs certos e sem repetição', () => {
    render(<DashboardSidebar />);
    const esperados = [
      ['Dashboard', '/dashboard-v2'],
      ['Assistente Montese', '/empresa/assistente'],
      ...SETORES.flatMap((s) => s.links.map(([l, h]) => [l, h])),
    ];
    expect(esperados).toHaveLength(24);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual(esperados);
  });

  it.each([
    ['/dashboard-v2', 'Dashboard'],
    ['/empresa/assistente', 'Assistente Montese'],
    ['/empresa/documentos', 'Documentos'],
    ['/empresa/inspecoes', 'Relatório de visita técnica'],
    ['/empresa/cipa', 'CIPA'],
    ['/empresa/cipa/eleicao', 'Eleição da CIPA'],
    ['/empresa/cipa/capacitacao', 'Capacitação da CIPA'],
    ['/empresa/brigada', 'Brigada de Incêndio'],
    ['/empresa/simulados', 'Simulados'],
    ['/empresa/epis', 'EPIs'],
    ['/empresa/mapa-sst', 'Mapa SST'],
    ['/empresa/agendamentos', 'Reuniões e Visitas'],
    ['/empresa/pente-fino', 'Auditoria Montese'],
    // subrotas
    ['/empresa/cipa/eleicao/2024/votos', 'Eleição da CIPA'],
    ['/empresa/documentos/abc-123/editar', 'Documentos'],
    ['/empresa/epis/novo', 'EPIs'],
    ['/empresa/agendamentos/9', 'Reuniões e Visitas'],
  ])('em %s só "%s" fica com aria-current (exatamente um)', (caminho, label) => {
    pathname = caminho;
    render(<DashboardSidebar />);
    const a = atuais();
    expect(a).toHaveLength(1);
    expect(a[0].textContent).toBe(label);
  });

  it('em /empresa/cipa/eleicao a "CIPA" (pai) não fica ativa', () => {
    pathname = '/empresa/cipa/eleicao';
    render(<DashboardSidebar />);
    expect(screen.getByRole('link', { name: 'Eleição da CIPA' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'CIPA' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    '/empresa/em-construcao',
    '/empresa/em-construcao/outra',
    '/rota-desconhecida',
    '/empresa/epis-extra',
  ])('em %s nenhum item fica com aria-current', (caminho) => {
    pathname = caminho;
    render(<DashboardSidebar />);
    expect(atuais()).toHaveLength(0);
  });

  it('o aria-current fica dentro do setor correto (subrota de Segurança não ativa item de outro setor)', () => {
    pathname = '/empresa/consulta-ca/pesquisa';
    render(<DashboardSidebar />);
    const lista = screen.getByRole('list', { name: 'Segurança' });
    const ativo = within(lista).getByRole('link', { name: 'Consulta de CA' });
    expect(ativo).toHaveAttribute('aria-current', 'page');
    expect(atuais()).toEqual([ativo]);
  });
});
