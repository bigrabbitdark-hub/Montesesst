import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GenerateMeetingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dia_semana_preferido?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  horario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  local?: string;
}
