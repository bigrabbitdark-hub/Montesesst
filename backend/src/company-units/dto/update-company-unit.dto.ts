import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanyUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  address_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  address_zip?: string;

  @IsOptional()
  @IsIn(['ativo', 'inativo', 'pendente'])
  status?: string;
}
