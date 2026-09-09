import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFireBrigadeTrainingDto {
  @IsISO8601()
  data_realizacao: string;

  @IsISO8601()
  data_validade: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  carga_horaria?: number;
}
