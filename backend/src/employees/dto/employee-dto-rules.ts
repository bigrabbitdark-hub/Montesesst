import { Transform } from 'class-transformer';

// Transformações compartilhadas por CreateEmployeeDto e UpdateEmployeeDto.

// CPF: o frontend (onboarding) envia com máscara ('123.456.789-09'); grava-se só os dígitos (VARCHAR(11)).
export const OnlyDigits = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value));

// Texto opcional: apara e converte vazio/só espaços em null (limpa o campo). Não-string passa e falha no validador.
export const BlankToNull = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t === '' ? null : t;
  });

// Nome obrigatório: apara as pontas (não converte vazio em null: continua inválido).
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
