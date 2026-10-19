import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockBadge } from '../StockBadge';
import { CaBadge } from '../CaBadge';
import { SignatureStatusBadge } from '../SignatureStatusBadge';
import type { CaAlert, SignatureStatus, StockBand } from '@/lib/epi/types';

const tone = (el: HTMLElement) => /bg-dash-status-(ok|warn|crit|info)-bg/.exec(el.className)?.[1];

describe('StockBadge', () => {
  it.each<[StockBand, string, string]>([
    ['sem_estoque', 'Sem estoque', 'crit'],
    ['abaixo', 'Abaixo do mínimo', 'warn'],
    ['otimo', 'Estoque ok', 'ok'],
    ['acima', 'Acima do máximo', 'info'],
  ])('%s mostra "%s" com tom %s', (band, text, t) => {
    render(<StockBadge band={band} />);
    expect(tone(screen.getByText(text))).toBe(t);
  });
  it('usa texto de 16px', () => {
    render(<StockBadge band="otimo" />);
    expect(screen.getByText('Estoque ok').className).toContain('text-base');
    expect(screen.getByText('Estoque ok').className).not.toContain('text-[11px]');
  });
});

describe('CaBadge', () => {
  it.each<[CaAlert, string, string]>([
    ['vencido', 'CA vencido', 'crit'],
    ['a_vencer', 'CA a vencer', 'warn'],
    ['ok', 'CA válido', 'ok'],
    ['sem_validade', 'CA sem validade', 'info'],
  ])('%s mostra "%s" com tom %s', (alert, text, t) => {
    render(<CaBadge alert={alert} />);
    expect(tone(screen.getByText(text))).toBe(t);
  });
});

describe('SignatureStatusBadge', () => {
  it.each<[SignatureStatus, string, string]>([
    ['pendente', 'Pendente', 'warn'],
    ['assinada', 'Assinada', 'ok'],
    ['recusada', 'Recusada', 'crit'],
    ['expirada', 'Expirada', 'crit'],
    ['presencial', 'Presencial', 'info'],
    ['legado', 'Anterior ao módulo', 'info'],
    ['estornada', 'Estornada', 'crit'],
  ])('%s mostra "%s" com tom %s', (status, text, t) => {
    render(<SignatureStatusBadge status={status} />);
    expect(tone(screen.getByText(text))).toBe(t);
  });
});
