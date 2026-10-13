import {
  isValidCpf, normalizeCbo, normalizeSex, normalizeEsocialRegistration,
  normalizeIsoDate, normalizeEmployeeInput,
} from '../src/employees/employee-fields.util';

describe('isValidCpf', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });
  it('rejeita dígito verificador errado, repetidos e tamanho errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
  });
});

describe('normalizeCbo', () => {
  it('preserva 6 dígitos e restaura zero à esquerda de número do Excel', () => {
    expect(normalizeCbo('717510')).toEqual({ ok: true, value: '717510' });
    expect(normalizeCbo(51210)).toEqual({ ok: true, value: '051210' });
  });
  it('rejeita vazio e mais de 6 dígitos', () => {
    expect(normalizeCbo('').ok).toBe(false);
    expect(normalizeCbo('1234567').ok).toBe(false);
  });
});

describe('normalizeSex', () => {
  it('aceita f/M em qualquer caixa', () => {
    expect(normalizeSex(' f ')).toEqual({ ok: true, value: 'F' });
    expect(normalizeSex('M')).toEqual({ ok: true, value: 'M' });
  });
  it('rejeita outros valores', () => expect(normalizeSex('X').ok).toBe(false));
});

describe('normalizeEsocialRegistration', () => {
  it('mantém zeros à esquerda como texto', () => {
    expect(normalizeEsocialRegistration('00012345678')).toEqual({ ok: true, value: '00012345678' });
  });
  it('rejeita espaços internos e excesso de tamanho', () => {
    expect(normalizeEsocialRegistration('12 34').ok).toBe(false);
    expect(normalizeEsocialRegistration('1'.repeat(31)).ok).toBe(false);
  });
});

describe('normalizeIsoDate', () => {
  it('aceita ISO e BR e devolve ISO sem fuso', () => {
    expect(normalizeIsoDate('2020-01-05')).toEqual({ ok: true, value: '2020-01-05' });
    expect(normalizeIsoDate('05/01/2020')).toEqual({ ok: true, value: '2020-01-05' });
  });
  it('rejeita data inexistente', () => {
    expect(normalizeIsoDate('31/02/2020').ok).toBe(false);
    expect(normalizeIsoDate('lixo').ok).toBe(false);
  });
});

describe('normalizeEmployeeInput', () => {
  it('normaliza campos presentes e ignora ausentes', () => {
    const { values, errors } = normalizeEmployeeInput({
      cpf: '529.982.247-25', sex: 'f', cbo_code: 51210, position: '  Soldador ', activity_description: '',
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      cpf: '52998224725', sex: 'F', cbo_code: '051210', position: 'Soldador', activity_description: null,
    });
  });
  it('vazio limpa campo opcional (null) mas nome vazio é erro', () => {
    const { values, errors } = normalizeEmployeeInput({ birth_date: '', full_name: '  ' });
    expect(values).toEqual({ birth_date: null });
    expect(errors.full_name).toBe('Nome é obrigatório');
  });
  it('acumula erros por campo', () => {
    const { errors } = normalizeEmployeeInput({ cpf: '1', sex: 'X', cbo_code: 'ab' });
    expect(Object.keys(errors).sort()).toEqual(['cbo_code', 'cpf', 'sex']);
  });
});
