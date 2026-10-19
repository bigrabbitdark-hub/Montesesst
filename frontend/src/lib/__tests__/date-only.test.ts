import { describe, it, expect } from 'vitest';
import { addMonths, formatDateBR, format } from '../date-only';

describe('addMonths', () => {
  it('caso bissexto: 2024-02-29 + 12 = 2025-02-28', () => {
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('preserva a data quando ela existe no mês de destino: 2024-02-29 + 48 = 2028-02-29', () => {
    expect(addMonths('2024-02-29', 48)).toBe('2028-02-29');
  });

  it('dia 31 que não existe no mês de destino vai pro último dia: 2026-01-31 + 1 = 2026-02-28', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('2026-08-31 + 6 meses: dia 31 não existe em fevereiro, usa último dia', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('2026-03-15 + 24 meses: dia 15 existe em 2028-03, mantém', () => {
    expect(addMonths('2026-03-15', 24)).toBe('2028-03-15');
  });

  it('somar zero meses devolve a mesma data', () => {
    expect(addMonths('2026-07-10', 0)).toBe('2026-07-10');
  });

  it('ano-virada: 2026-12-15 + 1 = 2027-01-15', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('rejeita string que não parece data', () => {
    expect(() => addMonths('ontem', 1)).toThrow();
  });
});

describe('formatDateBR', () => {
  it('formata AAAA-MM-DD em dd/mm/aaaa', () => {
    expect(formatDateBR('2026-03-01')).toBe('01/03/2026');
  });

  it('não desloca dia por fuso: 2026-03-01 continua 01/03/2026', () => {
    const formatted = formatDateBR('2026-03-01');
    expect(formatted).toBe('01/03/2026');
    expect(formatted.startsWith('01/03/')).toBe(true);
  });

  it('ignora sufixos de hora se vierem junto', () => {
    expect(formatDateBR('2026-03-01T00:00:00Z')).toBe('01/03/2026');
  });

  it('devolve string vazia para null/undefined/""', () => {
    expect(formatDateBR(null)).toBe('');
    expect(formatDateBR(undefined)).toBe('');
    expect(formatDateBR('')).toBe('');
  });
});

describe('alias format', () => {
  it('aponta pra mesma implementação', () => {
    expect(format).toBe(formatDateBR);
    expect(format('2026-12-25')).toBe('25/12/2026');
  });
});
