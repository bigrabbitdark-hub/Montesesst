import { FONTE_OFICIAL_NRS_URL, isNrCode, NR_CATALOG, NR_CODES } from '../src/nr-conformidade/nr-catalog';

describe('NR_CATALOG', () => {
  it('contém exatamente o catálogo confirmado pelo dono (2026-10-01), em ordem', () => {
    expect(NR_CODES).toEqual(['NR-1', 'NR-5', 'NR-6', 'NR-7', 'NR-15', 'NR-16', 'NR-23']);
  });
  it('códigos são únicos e todo item tem nome e regra', () => {
    expect(new Set(NR_CODES).size).toBe(NR_CODES.length);
    for (const e of NR_CATALOG) {
      expect(e.nome.length).toBeGreaterThan(0);
      expect(e.regra.fonte).toBeTruthy();
    }
  });
  it('isNrCode aceita só códigos do catálogo', () => {
    expect(isNrCode('NR-7')).toBe(true);
    expect(isNrCode('NR-99')).toBe(false);
    expect(isNrCode('nr-7')).toBe(false);
    expect(isNrCode(undefined)).toBe(false);
  });
  it('a fonte oficial é uma URL https de gov.br', () => {
    const u = new URL(FONTE_OFICIAL_NRS_URL);
    expect(u.protocol).toBe('https:');
    expect(u.hostname.endsWith('gov.br')).toBe(true);
  });
});
