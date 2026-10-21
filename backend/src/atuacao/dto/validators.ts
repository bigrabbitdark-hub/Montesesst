import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

// Data civil AAAA-MM-DD que existe de fato (rejeita 2026-02-30).
export function IsDataReal(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isDataReal', target: target.constructor, propertyName, options,
      validator: {
        validate(v: unknown) {
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
          const d = new Date(`${v}T00:00:00Z`);
          return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        },
        defaultMessage: (a: ValidationArguments) => `${a.property} deve ser uma data válida AAAA-MM-DD`,
      },
    });
}

// Hora HH:MM (00:00 a 23:59).
export function IsHoraReal(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isHoraReal', target: target.constructor, propertyName, options,
      validator: {
        validate: (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
        defaultMessage: (a: ValidationArguments) => `${a.property} deve ser uma hora válida HH:MM`,
      },
    });
}
