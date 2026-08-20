import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
