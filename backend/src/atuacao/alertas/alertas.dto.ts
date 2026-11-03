import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { CATEGORIAS_DOCUMENTO } from '../documentos/dto/documentos.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MOTIVOS_MUDANCA = ['funcao', 'processo', 'equipamento', 'risco', 'estabelecimento', 'outro'] as const;
export const NOTICE_PADRAO = [60, 30, 15, 7, 0] as const;

// Só antecedências e fonte: os meses de validade continuam sendo do admin (PATCH /documents/validity-rules/:category).
export class UpdateRegraDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(365, { each: true })
  notice_days!: number[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) source?: string;
}

export class CreateMudancaDto {
  @IsUUID() tenant_id!: string;
  @IsOptional() @IsUUID() document_id?: string;
  @IsOptional() @IsIn(CATEGORIAS_DOCUMENTO as unknown as string[]) category?: string;
  @IsIn(MOTIVOS_MUDANCA as unknown as string[]) reason!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class ResolverMudancaDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) nota?: string;
}

export class ListMudancasQuery {
  @IsOptional() @IsIn(['true', 'false']) abertas?: string;
  @IsOptional() @IsUUID() tenantId?: string;
}

export class ListNotificacoesQuery {
  @IsOptional() @IsIn(['true', 'false']) naoLidas?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}
