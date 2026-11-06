import { registerDecorator, ValidationOptions } from 'class-validator';

// bcrypt usa só os primeiros 72 BYTES da senha; @MaxLength conta caracteres e deixa passar
// senhas com acento que seriam truncadas em silêncio ('ç' ocupa 2 bytes em UTF-8). Ruling 26.
export const MSG_SENHA_72_BYTES = 'A senha não pode passar de 72 bytes (acentos e símbolos contam mais de 1)';

export function MaxBytes(max: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
        },
        defaultMessage() {
          return `O campo não pode passar de ${max} bytes`;
        },
      },
    });
  };
}
