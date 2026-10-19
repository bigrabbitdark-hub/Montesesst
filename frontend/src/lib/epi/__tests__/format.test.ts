import { describe, it, expect } from 'vitest';
import { addDays, diffDays, formatDate, formatDateTime, formatMoney, formatQty, todayDateOnly } from '../format';

describe('formatDate', () => {
  it('formata AAAA-MM-DD sem mexer em fuso', () => {
    expect(formatDate('2026-10-18')).toBe('18/10/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
  });
  it('coluna DATE serializada como ISO à meia-noite UTC mantém o dia escrito', () => {
    expect(formatDate('2026-10-18T00:00:00.000Z')).toBe('18/10/2026');
  });
  it('vazio ou inválido vira travessão', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('lixo')).toBe('—');
  });
});

describe('formatDateTime (America/Sao_Paulo)', () => {
  it('virada de dia: 18/10 01:30 UTC ainda é 17/10 22:30 em São Paulo', () => {
    expect(formatDateTime('2026-10-18T01:30:00Z')).toBe('17/10/2026 22:30');
  });
  it('03:00 UTC é meia-noite em São Paulo (00:00, nunca 24:00)', () => {
    expect(formatDateTime('2026-10-18T03:00:00Z')).toBe('18/10/2026 00:00');
  });
  it('02:59 UTC fica no dia anterior às 23:59', () => {
    expect(formatDateTime('2026-10-18T02:59:00Z')).toBe('17/10/2026 23:59');
  });
  it('respeita o offset do ISO', () => {
    expect(formatDateTime('2026-10-18T12:00:00-03:00')).toBe('18/10/2026 12:00');
  });
  it('vazio ou inválido vira travessão', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('nao-e-data')).toBe('—');
  });
});

describe('formatMoney / formatQty', () => {
  it('formata em reais com duas casas', () => {
    expect(formatMoney('12.5')).toBe('R$ 12,50');
    expect(formatMoney(1234.5)).toBe('R$ 1.234,50');
    expect(formatMoney('0')).toBe('R$ 0,00');
  });
  it('nulo ou inválido vira travessão', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('abc')).toBe('—');
  });
  it('quantidade com separador de milhar e travessão para nulo', () => {
    expect(formatQty(1234)).toBe('1.234');
    expect(formatQty(0)).toBe('0');
    expect(formatQty(null)).toBe('—');
  });
});

describe('datas de calendário', () => {
  it('todayDateOnly usa o dia de São Paulo', () => {
    expect(todayDateOnly(new Date('2026-10-18T01:30:00Z'))).toBe('2026-10-17');
    expect(todayDateOnly(new Date('2026-10-18T03:00:00Z'))).toBe('2026-10-18');
  });
  it('addDays e diffDays', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffDays('2026-10-18', '2026-10-17')).toBe(-1);
  });
});

describe('formatDate: calendário', () => {
  it('data inexistente no calendário vira travessão; datas válidas (inclusive 29/02 bissexto) passam', () => {
    expect(formatDate('2026-02-31')).toBe('—');
    expect(formatDate('2026-13-01')).toBe('—');
    expect(formatDate('2026-04-31')).toBe('—');
    expect(formatDate('2026-00-10')).toBe('—');
    expect(formatDate('2025-02-29')).toBe('—');
    expect(formatDate('2024-02-29')).toBe('29/02/2024');
    expect(formatDate('2026-02-28T00:00:00.000Z')).toBe('28/02/2026');
  });
});
