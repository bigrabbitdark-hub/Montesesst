import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateElectionDto {
  @IsUUID()
  company_unit_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsOptional()
  @IsISO8601()
  data_eleicao?: string;

  @IsISO8601()
  inicio_mandato: string;

  @IsISO8601()
  fim_mandato: string;
}
