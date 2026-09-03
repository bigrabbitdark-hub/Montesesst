import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSipatEditionDto {
  @IsUUID()
  company_unit_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsISO8601()
  periodo_inicio: string;

  @IsISO8601()
  periodo_fim: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tema?: string;
}
