import { IsOptional } from 'class-validator';

// Decorators para o ValidationPipe global (whitelist + forbidNonWhitelisted) reconhecer as
// propriedades; o formato de cada valor é validado por normalizeEmployeeInput.
export class UpdateEmployeeDto {
  @IsOptional()
  full_name?: string;

  @IsOptional()
  cpf?: string;

  @IsOptional()
  birth_date?: string;

  @IsOptional()
  position?: string;

  @IsOptional()
  admission_date?: string;

  @IsOptional()
  company_unit_id?: string;

  @IsOptional()
  position_id?: string;

  @IsOptional()
  status?: 'ativo' | 'inativo' | 'pendente';

  @IsOptional()
  esocial_registration?: string;

  @IsOptional()
  sex?: string;

  @IsOptional()
  cbo_code?: string;

  @IsOptional()
  activity_description?: string;
}
