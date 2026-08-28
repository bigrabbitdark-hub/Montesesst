import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateOfficialSourceDto {
  @IsString()
  @IsNotEmpty()
  entity: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsUrl()
  official_url: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
