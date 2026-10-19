// Validação de CNPJ numérico e ALFANUMÉRICO (Receita Federal, em vigor a partir de julho/2026).
// O CNPJ continua com 14 posições: as 12 primeiras são letras A-Z ou dígitos, e os 2 dígitos
// verificadores são sempre numéricos. O cálculo é o mesmo módulo 11 de antes, com o valor de cada
// caractere = código ASCII - 48 (dígitos valem 0..9 e as letras A..Z valem 17..42). Para CNPJ só
// numérico o resultado é idêntico ao algoritmo antigo. Exemplo oficial da Receita: 12ABC34501DE35.
const WEIGHTS_12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

// Remove máscara (. / - e espaços) e padroniza em maiúsculas. NÃO descarta letras: antes, qualquer
// letra era apagada em silêncio, o que deixava "abc11222333000181" passar como o CNPJ numérico.
export function normalizeCnpj(rawValue: string): string {
  return rawValue.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function isValidCnpj(rawValue: string): boolean {
  const cnpj = normalizeCnpj(rawValue);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const checkDigit = (base: string): number => {
    const weights = base.length === 12 ? WEIGHTS_12 : WEIGHTS_13;
    const sum = base.split('').reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * weights[i], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = cnpj.slice(0, 12);
  const d1 = checkDigit(base);
  const d2 = checkDigit(base + d1);
  return cnpj === `${base}${d1}${d2}`;
}

// Só dígitos. Mantido para quem realmente precisa de dígitos (CPF etc.); para CNPJ use normalizeCnpj.
export function onlyDigits(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}
