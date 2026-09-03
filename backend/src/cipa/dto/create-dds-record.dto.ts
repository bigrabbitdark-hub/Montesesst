import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDdsRecordDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data: string;

  @IsString()
  @MaxLength(300)
  tema: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  numero_participantes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}
