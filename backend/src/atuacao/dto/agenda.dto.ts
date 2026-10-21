import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AGENDA_STATUS, AGENDA_TIPOS } from '../agenda-status';
import { IsDataReal, IsHoraReal } from './validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Em PATCH, undefined = campo ausente; null NÃO é "ausente": cai nos validadores e dá 400.
const quandoPresente = () => ValidateIf((_o, v) => v !== undefined);
const TIPOS = AGENDA_TIPOS as unknown as string[];
const HTTPS = /^https:\/\/\S+$/;

export class CreateAgendaDto {
  @IsUUID() tenant_id!: string;
  @IsIn(TIPOS) type!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsDataReal() event_date!: string;
  @IsOptional() @IsHoraReal() start_time?: string;
  @IsOptional() @IsHoraReal() end_time?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @Matches(HTTPS) @MaxLength(500) meeting_link?: string;
  @IsOptional() @IsUUID() company_unit_id?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsUUID() owner_user_id?: string;
}

export class UpdateAgendaDto {
  @quandoPresente() @IsIn(TIPOS) type?: string;
  @quandoPresente() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @quandoPresente() @IsDataReal() event_date?: string;
  @quandoPresente() @IsHoraReal() start_time?: string;
  @quandoPresente() @IsHoraReal() end_time?: string;
  @quandoPresente() @IsString() @MaxLength(300) location?: string;
  @quandoPresente() @Matches(HTTPS) @MaxLength(500) meeting_link?: string;
  @quandoPresente() @IsUUID() company_unit_id?: string;
  @quandoPresente() @IsString() @MaxLength(4000) notes?: string;
  @quandoPresente() @IsUUID() owner_user_id?: string;
}

export class ChangeAgendaStatusDto {
  @IsIn(['concluido', 'cancelado']) status!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListAgendaQuery {
  @IsOptional() @IsDataReal() from?: string;
  @IsOptional() @IsDataReal() to?: string;
  @IsOptional() @IsIn(AGENDA_STATUS as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() @MaxLength(40) owner?: string; // 'me' ou uuid
}
