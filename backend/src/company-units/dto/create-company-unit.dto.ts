import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCompanyUnitDto {
  @IsString()
  @MaxLength(200)
  name: string;

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

  // Só é lido quando quem cria é role admin (empresa usa sempre o
  // próprio tenant_id do token) — mesmo padrão de CreateEmployeeDto.
  @IsOptional()
  @IsString()
  tenant_id?: string;
}
