import { Transform } from 'class-transformer';
import { ValidateBy, ValidationOptions } from 'class-validator';
import { isValidCpf, REGISTRATION_NUMBER_RE } from '../employee-fields.util';

// Transformações e validadores compartilhados por CreateEmployeeDto e UpdateEmployeeDto.

// CPF: o frontend (onboarding) envia com máscara ('123.456.789-09'); grava-se só os dígitos (VARCHAR(11)).
// Só a máscara (ponto, hífen, espaço) é removida: qualquer outro caractere permanece e reprova a validação
// (regra de isValidCpf, mais estrita que apagar tudo o que não é dígito).
export const OnlyDigits = () =>
  Transform(({ value }) => (typeof value === 'string' && /^[\d.\-\s]+$/.test(value) ? value.replace(/\D/g, '') : value));

// Texto opcional: apara e converte vazio/só espaços em null (limpa o campo). Não-string passa e falha no validador.
export const BlankToNull = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t === '' ? null : t;
  });

// Nome obrigatório: apara as pontas (não converte vazio em null: continua inválido).
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

// CPF com 11 dígitos E dígito verificador válido (mesma regra de normalizeEmployeeInput).
export const IsCpf = (options?: ValidationOptions) =>
  ValidateBy(
    { name: 'isCpf', validator: { validate: (v) => typeof v === 'string' && /^\d{11}$/.test(v) && isValidCpf(v) } },
    { message: 'CPF inválido', ...options },
  );

// Matrícula (employees.registration_number, usada pelo eSocial e pela ficha de EPI): 1 a 30 caracteres,
// letras, dígitos, ponto, sublinhado e hífen (mesma regra da CHECK da migration 0080).
export const IsRegistrationNumber = (options?: ValidationOptions) =>
  ValidateBy(
    { name: 'isRegistrationNumber', validator: { validate: (v) => typeof v === 'string' && REGISTRATION_NUMBER_RE.test(v) } },
    { message: 'Matrícula inválida (1 a 30 caracteres: letras, dígitos, ponto, hífen ou sublinhado; sem espaços)', ...options },
  );

// CBO: texto ('051210') ou número inteiro vindo de planilha/Excel (51210, o zero à esquerda é restaurado por
// normalizeCbo). Objeto, array, booleano e número não inteiro são recusados (400), nunca viram "[object Object]".
export const IsCboInput = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isCboInput',
      validator: {
        validate: (v) => (typeof v === 'string' && v.length <= 10) || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0),
      },
    },
    { message: 'CBO deve ter 6 dígitos (ex.: 717510)', ...options },
  );
