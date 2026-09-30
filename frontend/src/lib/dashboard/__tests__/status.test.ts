import { describe, it, expect } from 'vitest';
import { scoreTone, formatarData, diasEntre } from '../status';

describe('scoreTone', () => {
  it.each([
    [0, 'crit'], [59, 'crit'], [60, 'high'], [79, 'high'],
    [80, 'warn'], [89, 'warn'], [90, 'ok'], [100, 'ok'],
  ])('score %i → %s', (score, tone) => expect(scoreTone(score)).toBe(tone));

  it('limita valores fora de 0–100', () => {
    expect(scoreTone(-5)).toBe('crit');
    expect(scoreTone(140)).toBe('ok');
  });
});

describe('datas', () => {
  it('formata dd/mm/aaaa', () => expect(formatarData('2026-10-15')).toBe('15/10/2026'));
  it('56 dias de 30/09 a 25/11/2026', () => expect(diasEntre('2026-09-30', '2026-11-25')).toBe(56));
  it('data passada dá negativo', () => expect(diasEntre('2026-10-02', '2026-10-01')).toBe(-1));
});
