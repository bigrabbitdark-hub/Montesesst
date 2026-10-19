import {
  isValidCpf, normalizeCbo, normalizeSex, normalizeRegistrationNumber,
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
    expect(normalizeCbo('1').ok).toBe(false);
    expect(normalizeCbo('1234').ok).toBe(false);
  });
});

describe('normalizeSex', () => {
  it('aceita f/M em qualquer caixa', () => {
    expect(normalizeSex(' f ')).toEqual({ ok: true, value: 'F' });
    expect(normalizeSex('M')).toEqual({ ok: true, value: 'M' });
  });
  it('rejeita outros valores', () => expect(normalizeSex('X').ok).toBe(false));
});

describe('normalizeRegistrationNumber', () => {
  it('mantém zeros à esquerda como texto', () => {
    expect(normalizeRegistrationNumber('00012345678')).toEqual({ ok: true, value: '00012345678' });
  });
  it('rejeita espaços internos e excesso de tamanho', () => {
    expect(normalizeRegistrationNumber('12 34').ok).toBe(false);
    expect(normalizeRegistrationNumber('1'.repeat(31)).ok).toBe(false);
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

describe('endurecimento: não inventar dados', () => {
  it('isValidCpf aceita só dígitos e separadores . - e espaço', () => {
    expect(isValidCpf('529.982.247-25abc')).toBe(false);
    expect(isValidCpf('abc52998224725')).toBe(false);
    expect(isValidCpf('529 982 247 25')).toBe(true);
    expect(normalizeEmployeeInput({ cpf: '529.982.247-25abc' }).errors.cpf).toBe('CPF inválido');
    expect(normalizeEmployeeInput({ cpf: '529.982.247-25' }).values.cpf).toBe('52998224725');
  });
  it('normalizeCbo rejeita letras e decimais', () => {
    expect(normalizeCbo('12ab34').ok).toBe(false);
    expect(normalizeCbo(51210.5).ok).toBe(false);
    expect(normalizeCbo('51210.5').ok).toBe(false);
    expect(normalizeCbo(' 51210 ')).toEqual({ ok: true, value: '051210' });
    expect(normalizeCbo(51210)).toEqual({ ok: true, value: '051210' });
  });
});

describe('normalizeEmployeeInput — UUIDs', () => {
  it('rejeita filial/cargo que não são UUID e normaliza caixa', () => {
    const bad = normalizeEmployeeInput({ company_unit_id: 'abc', position_id: '1' });
    expect(bad.errors).toEqual({ company_unit_id: 'Filial inválida', position_id: 'Cargo inválido' });
    const ok = normalizeEmployeeInput({ company_unit_id: '3F2504E0-4F89-41D3-9A0C-0305E82C3301', position_id: '' });
    expect(ok.errors).toEqual({});
    expect(ok.values).toEqual({ company_unit_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', position_id: null });
  });
});

describe('normalizeEmployeeInput — matrícula única e setor (merge com a ficha de EPI)', () => {
  it('registration_number segue a regra oficial; vazio vira null', () => {
    expect(normalizeEmployeeInput({ registration_number: ' M-0042 ' }).values).toEqual({ registration_number: 'M-0042' });
    expect(normalizeEmployeeInput({ registration_number: '  ' }).values).toEqual({ registration_number: null });
    expect(normalizeEmployeeInput({ registration_number: 'M 42' }).errors.registration_number).toBeDefined();
    expect(normalizeEmployeeInput({ registration_number: 'x'.repeat(31) }).errors.registration_number).toBeDefined();
    expect(normalizeEmployeeInput({ registration_number: 'x'.repeat(30) }).errors).toEqual({});
  });

  it('department e position: até 120, sem NUL; vazio vira null', () => {
    expect(normalizeEmployeeInput({ department: ' Produção ' }).values).toEqual({ department: 'Produção' });
    expect(normalizeEmployeeInput({ department: '' }).values).toEqual({ department: null });
    expect(normalizeEmployeeInput({ department: 'y'.repeat(121) }).errors.department).toBeDefined();
    expect(normalizeEmployeeInput({ department: 'a\u0000b' }).errors.department).toBeDefined();
    expect(normalizeEmployeeInput({ position: 'p'.repeat(121) }).errors.position).toBeDefined();
    expect(normalizeEmployeeInput({ position: 'p'.repeat(120) }).errors).toEqual({});
  });

  it('nome: até 200 e sem NUL', () => {
    expect(normalizeEmployeeInput({ full_name: 'n'.repeat(201) }).errors.full_name).toBeDefined();
    expect(normalizeEmployeeInput({ full_name: 'a\u0000b' }).errors.full_name).toBeDefined();
  });

  it('esocial_registration não é mais campo aceito (ignorado como qualquer chave desconhecida)', () => {
    expect(normalizeEmployeeInput({ esocial_registration: 'M-1' })).toEqual({ values: {}, errors: {} });
  });
});
