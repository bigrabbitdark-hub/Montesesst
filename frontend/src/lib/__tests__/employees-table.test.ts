import { describe, expect, it } from 'vitest';
import { brToIso, diffRows, EDITABLE_COLUMNS, formatCpf, isoToBr, type EmployeeTableRow } from '../employees-table';

function row(over: Partial<EmployeeTableRow> = {}): EmployeeTableRow {
  return {
    id: 'e1', sequence: 1, row_version: '3', full_name: 'Ana Teste', registration_number: '00012345678',
    cpf: '52998224725', birth_date: '1990-02-03', sex: 'F', position: 'Soldadora', department: null, admission_date: '2020-01-05',
    cbo_code: '051210', activity_description: null, company_unit_id: null, status: 'active', ...over,
  };
}

describe('employees-table lib', () => {
  it('formatCpf aplica a máscara', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
  it('isoToBr converte sem Date', () => {
    expect(isoToBr('2020-01-05')).toBe('05/01/2020');
    expect(isoToBr(null)).toBe('');
  });
  it('brToIso converte e rejeita inválidas', () => {
    expect(brToIso('05/01/2020')).toBe('2020-01-05');
    expect(brToIso('99/99/2020')).toBeNull();
    expect(brToIso('31/02/2020')).toBeNull();
  });
  it('EDITABLE_COLUMNS não inclui sequence', () => {
    expect(EDITABLE_COLUMNS.map((c) => c.key)).not.toContain('sequence');
  });
  it('diffRows devolve só o alterado, com row_version original', () => {
    const original = [row(), row({ id: 'e2', row_version: '7', full_name: 'Bruno Teste' })];
    const draft = [row({ position: 'Pintora' }), row({ id: 'e2', row_version: '7', full_name: 'Bruno Teste' })];
    expect(diffRows(original, draft)).toEqual([{ id: 'e1', row_version: '3', fields: { position: 'Pintora' } }]);
  });
  it('diffRows devolve [] sem mudanças', () => {
    expect(diffRows([row()], [row()])).toEqual([]);
  });
  it('diffRows envia string vazia para limpar campo', () => {
    const d = diffRows([row()], [row({ position: null })]);
    expect(d[0].fields).toEqual({ position: '' });
  });
  it('diffRows ignora espaços nas pontas (o backend aplica trim)', () => {
    expect(diffRows([row()], [row({ position: 'Soldadora  ' })])).toEqual([]);
  });
});
