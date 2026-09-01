import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateMeetingDto {
  @IsOptional() @IsISO8601() data?: string;
  @IsOptional() @IsString() @MaxLength(5) hora?: string;
  @IsOptional() @IsString() @MaxLength(200) local?: string;
  @IsOptional() @IsIn(['presencial', 'online', 'hibrida']) modalidade?: string;
  @IsOptional() @IsUUID() responsavel_user_id?: string;
  @IsOptional() @IsIn(['planejada', 'agendada', 'realizada', 'cancelada', 'reagendada']) status?: string;
  @IsOptional() @IsBoolean() chk_pauta_definida?: boolean;
  @IsOptional() @IsBoolean() chk_participantes_convocados?: boolean;
  @IsOptional() @IsBoolean() chk_local_confirmado?: boolean;
  @IsOptional() @IsBoolean() chk_presenca_registrada?: boolean;
  @IsOptional() @IsBoolean() chk_assuntos_discutidos?: boolean;
  @IsOptional() @IsBoolean() chk_decisoes_registradas?: boolean;
  @IsOptional() @IsBoolean() chk_ata_criada?: boolean;
  @IsOptional() @IsBoolean() chk_acoes_distribuidas?: boolean;
  @IsOptional() @IsBoolean() chk_pendencias_registradas?: boolean;
  @IsOptional() @IsString() @MaxLength(5000) pauta?: string;
  @IsOptional() @IsString() @MaxLength(10000) discussoes?: string;
  @IsOptional() @IsString() @MaxLength(10000) deliberacoes?: string;
  @IsOptional() @IsISO8601() proxima_reuniao_data?: string;
}
