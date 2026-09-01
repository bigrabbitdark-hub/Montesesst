import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class GenerateMeetingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dia_semana_preferido?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido, use HH:MM' })
  horario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  local?: string;
}
