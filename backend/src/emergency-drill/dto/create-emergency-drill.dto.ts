import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EmergencyDrillParticipantDto {
  @IsUUID()
  employee_id: string;

  @IsBoolean()
  presente: boolean;
}

export class CreateEmergencyDrillDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data_realizacao: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido, use HH:MM' })
  horario?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tempo_evacuacao_segundos?: number;

  @IsOptional()
  @IsBoolean()
  ponto_encontro_adequado?: boolean;

  @IsOptional()
  @IsBoolean()
  falhas_sinalizacao?: boolean;

  @IsOptional()
  @IsBoolean()
  falhas_iluminacao?: boolean;

  @IsOptional()
  @IsBoolean()
  portas_bloqueadas?: boolean;

  @IsOptional()
  @IsBoolean()
  extintores_obstruidos?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmergencyDrillParticipantDto)
  participants: EmergencyDrillParticipantDto[];

  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
