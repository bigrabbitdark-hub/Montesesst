import { maskCpf } from '../src/epi-ficha/cpf-mask.util';

describe('maskCpf', () => {
  it('mostra só os dígitos 4 a 9', () => {
    expect(maskCpf('39053344705')).toBe('***.533.447-**');
  });
  it('aceita CPF formatado', () => {
    expect(maskCpf('390.533.447-05')).toBe('***.533.447-**');
  });
  it('valor inválido nunca vaza dígitos', () => {
    expect(maskCpf('123')).toBe('***.***.***-**');
    expect(maskCpf('')).toBe('***.***.***-**');
    // Comportamento real: só vale a máscara correta se, removidos os não-dígitos, restam EXATAMENTE 11.
    expect(maskCpf('123456789012')).toBe('***.***.***-**'); // 12 dígitos
    expect(maskCpf('abcdefghijk')).toBe('***.***.***-**'); // nenhum dígito
    expect(maskCpf('390.533x447-05')).toBe('***.533.447-**'); // 11 dígitos com lixo no meio
    expect(maskCpf(null)).toBe('***.***.***-**');
    expect(maskCpf(undefined)).toBe('***.***.***-**');
  });
});
