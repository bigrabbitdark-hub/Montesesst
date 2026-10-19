export function onlyDigitsStr(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

// CPF com dígitos verificadores (rejeita sequências repetidas).
export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigitsStr(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

// Formato do CNPJ aceito pelo XSD (TS_cnpj, inclui o alfanumérico). Só formato: o dígito
// verificador do CNPJ alfanumérico é a tarefa N8 e não é reimplementado aqui.
export function isCnpjFormat(raw: string): boolean {
  return /^[A-Z0-9]{12}\d{2}$/.test((raw ?? '').toUpperCase());
}

export const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
