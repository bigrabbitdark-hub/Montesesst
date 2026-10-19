import { isValidCnpj, normalizeCnpj } from '../src/common/validators/cnpj.util';

describe('CNPJ numérico e alfanumérico', () => {
  it('aceita o exemplo oficial da Receita (alfanumérico), com e sem máscara e em minúsculas', () => {
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12.abc.345/01de-35')).toBe(true);
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('continua aceitando CNPJ numérico válido, com ou sem máscara (resultado idêntico ao algoritmo antigo)', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000180')).toBe(false);
  });

  it('reprova dígito verificador errado, tamanho errado e DV não numérico', () => {
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('12ABC34501DE3')).toBe(false);
    expect(isValidCnpj('12ABC34501DE3A')).toBe(false);
    expect(isValidCnpj('')).toBe(false);
  });

  it('reprova sequências repetidas', () => {
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('AAAAAAAAAAAAAA')).toBe(false);
  });

  it('não apaga letras em silêncio (antes "abc11222333000181" virava um CNPJ numérico válido)', () => {
    expect(isValidCnpj('abc11222333000181')).toBe(false);
    expect(normalizeCnpj('abc11222333000181')).toBe('ABC11222333000181');
  });
});
