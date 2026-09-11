import { normalizePositionText } from '../src/common/text/normalize-position-text.util';

describe('normalizePositionText', () => {
  it('remove acento, deixa minúsculo, colapsa espaços', () => {
    expect(normalizePositionText('  Soldador  Sênior  ')).toBe('soldador senior');
  });

  it('trata nomes diferentes com mesma normalização como iguais', () => {
    expect(normalizePositionText('AUXILIAR DE PRODUÇÃO')).toBe(normalizePositionText('auxiliar de producao'));
  });
});
