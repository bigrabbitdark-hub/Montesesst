import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateExtraordinariaDto {
  @IsUUID()
  committee_id: string;

  @IsString()
  @MaxLength(200)
  titulo: string;

  @IsOptional()
  @IsISO8601()
  data?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido, use HH:MM' })
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  local?: string;

  @IsOptional()
  @IsIn(['presencial', 'online', 'hibrida'])
  modalidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;

  @IsOptional()
  @IsUUID()
  responsavel_user_id?: string;
}
