// Algoritmo padrão de validação de CNPJ (dígito verificador, módulo 11).
// Exemplo real usado nos testes (register.e2e-spec.ts): 11222333000181
// é matematicamente válido por este algoritmo (conferido manualmente antes
// de escrever este arquivo, não é um número "de exemplo" arbitrário).
export function isValidCnpj(rawValue: string): boolean {
  const digits = rawValue.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcCheckDigit = (base: string): number => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base
      .split('')
      .reduce((acc, digit, idx) => acc + parseInt(digit, 10) * weights[idx], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = digits.slice(0, 12);
  const digit1 = calcCheckDigit(base);
  const digit2 = calcCheckDigit(base + digit1);
  return digits === `${base}${digit1}${digit2}`;
}

// CNPJ limpo (só dígitos) — usado pelo RegisterDto pra normalizar antes de
// validar e antes de gravar no banco (coluna VARCHAR(14)).
export function onlyDigits(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}
