import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { isValidCnpj } from './cnpj.util';

export function IsValidCnpj(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidCnpj',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidCnpj(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} não é um CNPJ válido`;
        },
      },
    });
  };
}
