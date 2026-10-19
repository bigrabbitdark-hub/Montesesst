import { normalizeOccurredAt } from '../src/epi/occurred-at.util';

describe('normalizeOccurredAt', () => {
  it('ausente -> undefined (o banco usa now())', () => {
    expect(normalizeOccurredAt(undefined)).toBeUndefined();
  });
  it('só data -> meio-dia de São Paulo', () => {
    expect(normalizeOccurredAt('2026-10-14')).toBe('2026-10-14T12:00:00-03:00');
  });
  it('datetime com Z ou offset fica inalterado', () => {
    expect(normalizeOccurredAt('2026-10-14T01:30:00Z')).toBe('2026-10-14T01:30:00Z');
    expect(normalizeOccurredAt('2026-10-14T01:30:00.123+02:00')).toBe('2026-10-14T01:30:00.123+02:00');
  });
  it('datetime sem offset -> horário de São Paulo', () => {
    expect(normalizeOccurredAt('2026-10-14T23:30')).toBe('2026-10-14T23:30-03:00');
    expect(normalizeOccurredAt('2026-10-14T23:30:15.5')).toBe('2026-10-14T23:30:15.5-03:00');
  });
});
