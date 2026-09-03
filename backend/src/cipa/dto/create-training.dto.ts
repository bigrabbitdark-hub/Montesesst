import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TRAINING_TYPES } from '../trainings.service';

export class CreateTrainingDto {
  @IsUUID()
  employee_id: string;

  @IsIn(TRAINING_TYPES)
  tipo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tipo_outro?: string;

  @IsISO8601()
  data_realizacao: string;

  @IsISO8601()
  data_validade: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  carga_horaria?: number;
}
