import { describe, expect, it } from 'vitest';
import { FIELD_LABELS, formatChangedAt, formatHistoryValue, roleLabel, sourceLabel } from '../employees-history';

describe('employees-history', () => {
  it('rótulos dos 11 campos rastreados', () => {
    expect(FIELD_LABELS.cbo_code).toBe('CBO');
    expect(FIELD_LABELS.esocial_registration).toBe('Matrícula eSocial');
    expect(Object.keys(FIELD_LABELS)).toHaveLength(11);
  });
  it('formata valores', () => {
    expect(formatHistoryValue('birth_date', '1990-02-03')).toBe('03/02/1990');
    expect(formatHistoryValue('sex', 'F')).toBe('F');
    expect(formatHistoryValue('position', null)).toBe('—');
    expect(formatHistoryValue('cpf', '***.***.***-25')).toBe('***.***.***-25');
    expect(formatHistoryValue('company_unit_id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('Outra filial');
  });
  it('rótulos de origem e papel', () => {
    expect(sourceLabel('tabela')).toBe('Edição da tabela');
    expect(sourceLabel('qualquer')).toBe('Outra origem');
    expect(roleLabel(null)).toBe('Sistema');
    expect(roleLabel('admin')).toBe('Administrador Montese');
  });
  it('formata data/hora em horário de Brasília', () => {
    expect(formatChangedAt('2026-10-13T15:30:00Z')).toBe('13/10/2026 12:30');
  });
  it('meia-noite local não vira 24:xx', () => {
    expect(formatChangedAt('2026-10-13T03:05:00Z')).toBe('13/10/2026 00:05');
  });
});
