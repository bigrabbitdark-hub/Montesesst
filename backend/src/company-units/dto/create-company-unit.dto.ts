import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsValidCnpj } from '../../common/validators/is-valid-cnpj.decorator';
import { onlyDigits } from '../../common/validators/cnpj.util';

export class CreateCompanyUnitDto {
  @IsString()
  @MaxLength(200)
  name: string;

  // Obrigatório em filial nova. Aceita máscara; grava só dígitos (VARCHAR(14)).
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @IsValidCnpj()
  cnpj: string;

  @IsString()
  @MaxLength(300)
  address_street: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsString()
  @MaxLength(200)
  address_city: string;

  @IsString()
  @MaxLength(2)
  address_state: string;

  @IsString()
  @MaxLength(8)
  address_zip: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_complement?: string;

  @IsOptional()
  @Matches(/^(\d{7})?$/, { message: 'cnae_code deve ter 7 dígitos' })
  cnae_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cnae_description?: string;

  // Só é lido quando quem cria é role admin (empresa usa sempre o
  // próprio tenant_id do token) — mesmo padrão de CreateEmployeeDto.
  @IsOptional()
  @IsString()
  tenant_id?: string;
}
