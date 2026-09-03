import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSipatActivityDto {
  @IsOptional()
  @IsIn(['planejada', 'realizada', 'cancelada'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  numero_participantes?: number;
}
