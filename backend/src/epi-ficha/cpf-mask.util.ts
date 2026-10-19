// CPF protegido: só os dígitos 4 a 9 ficam visíveis. Entrada inválida nunca devolve dígito.
export function maskCpf(cpf: string | null | undefined): string {
  const digits = (cpf ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return '***.***.***-**';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}
