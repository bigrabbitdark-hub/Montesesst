// CNPJ numérico sintético com dígitos verificadores válidos (filial nova exige CNPJ desde a 0077/DTO).
// Aleatório para não colidir com o índice único (tenant_id, cnpj) quando o mesmo tenant cria várias filiais.
import { isValidCnpj } from '../../src/common/validators/cnpj.util';

function checkDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base.split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function randomValidCnpj(): string {
  for (;;) {
    let base = '';
    for (let i = 0; i < 8; i++) base += Math.floor(Math.random() * 10);
    base += '0002';
    const d1 = checkDigit(base);
    const cnpj = `${base}${d1}${checkDigit(base + d1)}`;
    if (isValidCnpj(cnpj)) return cnpj;
  }
}
