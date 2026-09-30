import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ScoreRing } from '../ScoreRing';
import { AuditoriaCard } from '../AuditoriaCard';
import { PendenciasCard } from '../PendenciasCard';
import { VencimentosCard } from '../VencimentosCard';
import { ProximosEventosCard } from '../ProximosEventosCard';
import { EmBreveCard } from '../EmBreveCard';
import { KpiCard } from '../KpiCard';
import type { ItemLista, VencimentoItem } from '@/lib/dashboard/real';

const itens: ItemLista[] = [
  { id: '1', titulo: 'Documento vencido: PGR', detalhe: 'Sua empresa · 15/10/2026', rotulo: 'Urgente', tone: 'crit', href: '/empresa/documentos' },
  { id: '2', titulo: 'CA vencendo: Luva', detalhe: 'Sua empresa', rotulo: 'A vencer', tone: 'warn', href: '/empresa/epis' },
];

describe('ScoreRing', () => {
  it('mostra o percentual, o nível em texto e o aria-label', () => {
    render(<ScoreRing score={92} nivel="Excelente" />);
    expect(screen.getByRole('img', { name: 'Score SST 92%, Excelente' })).toBeInTheDocument();
    expect(screen.getByText('Excelente')).toBeInTheDocument();
  });
  it('score baixo mantém o nível em texto (cor não é o único indicador)', () => {
    render(<ScoreRing score={55} nivel="Crítico" />);
    expect(screen.getByText('Crítico')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('55%');
  });
  it('sem documentos com validade: mostra "Sem dados" e a nota, sem anel nem 0%', () => {
    render(<ScoreRing score={null} nivel="Sem dados" nota="Cadastre documentos com validade para calcular." />);
    expect(screen.getByText('Sem dados')).toBeInTheDocument();
    expect(screen.getByText(/Cadastre documentos/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });
});

describe('AuditoriaCard (só PGR × PCMSO é real)', () => {
  it('mostra as contagens, o selo em texto e declara o resto "em breve"', () => {
    render(<AuditoriaCard pgrPcmso={{ risco_sem_exame: 2, exame_sem_risco: 1 }} />);
    expect(screen.getByText('2 riscos sem exame correspondente')).toBeInTheDocument();
    expect(screen.getByText('1 exame sem risco correspondente')).toBeInTheDocument();
    expect(screen.getByText('Alta')).toBeInTheDocument();
    expect(screen.getByText('Média')).toBeInTheDocument();
    expect(screen.getByText(/PGR × LTCAT/).closest('p')).toHaveTextContent(/Em breve:.*PGR × LTCAT.*PCMSO × S-2220/);
    expect(screen.getByRole('link', { name: 'Abrir Pente-Fino' })).toHaveAttribute('href', '/empresa/pente-fino');
  });
  it('zero divergências', () => {
    render(<AuditoriaCard pgrPcmso={{ risco_sem_exame: 0, exame_sem_risco: 0 }} />);
    expect(screen.getByText('Nenhuma divergência encontrada no Pente-Fino.')).toBeInTheDocument();
  });
  it('backend sem o dado: não inventa, diz indisponível', () => {
    render(<AuditoriaCard />);
    expect(screen.getByText(/dado indisponível/)).toBeInTheDocument();
    expect(screen.queryByText('Abrir Pente-Fino')).toBeNull();
  });
});

describe('PendenciasCard', () => {
  it('lista com link, detalhe e rótulo em texto', () => {
    render(<PendenciasCard itens={itens} resumo="1 pendência · 1 aviso" />);
    expect(screen.getByRole('link', { name: 'Documento vencido: PGR' })).toHaveAttribute('href', '/empresa/documentos');
    expect(screen.getByText('Sua empresa · 15/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Urgente')).toBeInTheDocument();
    expect(screen.getByText('1 pendência · 1 aviso')).toBeInTheDocument();
  });
  it('lista vazia', () => {
    render(<PendenciasCard itens={[]} resumo="0 pendências · 0 avisos" />);
    expect(screen.getByText('Nenhuma pendência no momento.')).toBeInTheDocument();
  });
});

describe('VencimentosCard', () => {
  const v = (id: string, nome: string, validade: string): VencimentoItem => ({ id, nome, validade, href: '/empresa/documentos' });
  it('diz em texto se venceu, vence hoje ou vence em N dias', () => {
    render(<VencimentosCard hoje="2026-09-30" itens={[v('a', 'PGR', '2026-09-20'), v('b', 'PCMSO', '2026-09-30'), v('c', 'LTCAT', '2026-11-25'), v('d', 'PPP', '2026-10-01')]} />);
    expect(screen.getByText(/venceu há 10 dias — 20\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/vence hoje — 30\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/vence em 56 dias — 25\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/vence em 1 dia — 01\/10\/2026/)).toBeInTheDocument();
  });
  it('vazio', () => {
    render(<VencimentosCard hoje="2026-09-30" itens={[]} />);
    expect(screen.getByText('Nenhum vencimento em destaque.')).toBeInTheDocument();
  });
});

describe('ProximosEventosCard', () => {
  it('lista os eventos dos próximos 7 dias', () => {
    render(<ProximosEventosCard itens={itens} />);
    const li = screen.getAllByRole('listitem');
    expect(li).toHaveLength(2);
    expect(within(li[1]).getByText('CA vencendo: Luva')).toBeInTheDocument();
  });
  it('vazio', () => {
    render(<ProximosEventosCard itens={[]} />);
    expect(screen.getByText('Nenhum evento nos próximos 7 dias.')).toBeInTheDocument();
  });
});

describe('EmBreveCard e KpiCard', () => {
  it('"Em breve" não exibe número nem barra', () => {
    render(<EmBreveCard titulo="eSocial" descricao="Ainda não disponível." />);
    expect(screen.getByText('Em breve')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it('KpiCard aceita "—" quando a contagem falhou', () => {
    render(<KpiCard label="Funcionários" value="—" hint="ativos" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('ApoioTecnicoCard', () => {
  it('leva à página de Reuniões e Visitas e a foto tem texto alternativo', async () => {
    const { ApoioTecnicoCard } = await import('../ApoioTecnicoCard');
    render(<ApoioTecnicoCard />);
    expect(screen.getByRole('link', { name: 'Agendar reunião ou visita' })).toHaveAttribute('href', '/empresa/agendamentos');
    expect(screen.getByRole('img', { name: /RH e técnico/ })).toBeInTheDocument();
  });
});

describe('DashboardBanner', () => {
  it('mantém o título como h1 e exibe a atribuição CC BY-SA com link', async () => {
    const { DashboardBanner } = await import('../DashboardBanner');
    render(<DashboardBanner titulo="Painel de Controle SST" subtitulo="Empresa X · CNPJ —" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Painel de Controle SST' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Macribo71 · CC BY-SA 4.0/ }).getAttribute('href')).toContain('commons.wikimedia.org');
  });
});
