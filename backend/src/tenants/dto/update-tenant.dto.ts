import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  trade_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact_role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  address_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  address_zip?: string;

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
}
