import { describe, it, expect } from 'vitest';
import { homeFor } from '../auth';

describe('homeFor', () => {
  it('empresa cai no dashboard novo', () => expect(homeFor('empresa')).toBe('/dashboard-v2'));
  it('técnico/parceiro e admin mantêm a própria página inicial', () => {
    expect(homeFor('tecnico')).toBe('/tecnico/empresas');
    expect(homeFor('parceiro')).toBe('/tecnico/empresas');
    expect(homeFor('admin')).toBe('/admin/overview');
  });
});
