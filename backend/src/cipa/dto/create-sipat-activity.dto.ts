import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSipatActivityDto {
  @IsISO8601()
  data: string;

  @IsString()
  @MaxLength(300)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  publico_alvo?: string;
}
