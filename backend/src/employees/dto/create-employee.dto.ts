import { IsDefined, IsOptional } from 'class-validator';

// Os decorators existem para o ValidationPipe global (whitelist + forbidNonWhitelisted)
// reconhecer as propriedades; sem eles TODO campo era rejeitado ("property X should not exist").
// Tipo e formato de cada valor são validados por normalizeEmployeeInput (employee-fields.util.ts).
export class CreateEmployeeDto {
  @IsDefined()
  full_name: string;

  @IsDefined()
  cpf: string;

  @IsOptional()
  birth_date?: string;

  @IsOptional()
  position?: string;

  @IsOptional()
  admission_date?: string;

  @IsOptional()
  company_unit_id?: string;

  // Só é lido quando quem cria é role admin (empresa usa sempre o próprio tenant_id do token).
  @IsOptional()
  tenant_id?: string;

  @IsOptional()
  esocial_registration?: string;

  @IsOptional()
  sex?: string;

  @IsOptional()
  cbo_code?: string;

  @IsOptional()
  activity_description?: string;
}
