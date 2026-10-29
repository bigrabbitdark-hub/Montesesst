import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { IsDataReal } from './validators';

export const INTERACAO_TIPOS = ['reuniao', 'ligacao', 'email', 'visita', 'outro'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Em PATCH, undefined = campo ausente; null NÃO é "ausente": cai nos validadores e dá 400.
const quandoPresente = () => ValidateIf((_o, v) => v !== undefined);
const TIPOS = INTERACAO_TIPOS as unknown as string[];

// created_by e tenant_id nunca vêm do corpo (forbidNonWhitelisted => 400); o tenant vem do caminho.
export class CreateInteracaoDto {
  @IsIn(TIPOS) type!: string;
  @IsDataReal() occurred_on!: string; // futuro é aceito (contato planejado)
  @IsOptional() @IsString() @MaxLength(1000) participants?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) summary!: string;
  @IsOptional() @IsString() @MaxLength(4000) decisions?: string;
  @IsOptional() @IsString() @MaxLength(4000) next_steps?: string;
  @IsOptional() @IsUUID() agenda_event_id?: string;
}

export class UpdateInteracaoDto {
  @quandoPresente() @IsIn(TIPOS) type?: string;
  @quandoPresente() @IsDataReal() occurred_on?: string;
  @quandoPresente() @IsString() @MaxLength(1000) participants?: string;
  @quandoPresente() @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) summary?: string;
  @quandoPresente() @IsString() @MaxLength(4000) decisions?: string;
  @quandoPresente() @IsString() @MaxLength(4000) next_steps?: string;
  @quandoPresente() @IsUUID() agenda_event_id?: string;
}

// GET /atuacao/interacoes (histórico global). Propriedades desconhecidas são rejeitadas pelo ValidationPipe global.
export class ListInteracoesQuery {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsIn(TIPOS) tipo?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}
