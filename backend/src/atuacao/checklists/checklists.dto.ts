import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const SERVICOS_CHECKLIST = [
  'pgr', 'ltcat', 'laudo_insalubridade', 'laudo_periculosidade', 'relatorio_inspecao', 'apr', 'ordem_servico', 'outro',
] as const;
export const TIPOS_ITEM = ['sim_nao_na', 'texto', 'numero', 'data'] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];
export const MAX_ITENS = 100;

export class CreateModeloDto {
  @IsIn(SERVICOS_CHECKLIST as unknown as string[]) service!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
}

export class NovaVersaoModeloDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) change_note?: string;
}

export class ItemModeloDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) label!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) instruction?: string;
  @IsIn(TIPOS_ITEM as unknown as string[]) kind!: TipoItem;
  @IsBoolean() required!: boolean;
  @IsBoolean() blocks_review!: boolean;
}

// Substitui o conjunto de itens do rascunho (a ordem do array define a posição).
export class DefinirItensDto {
  @IsArray() @ArrayMaxSize(MAX_ITENS) @ValidateNested({ each: true }) @Type(() => ItemModeloDto) items!: ItemModeloDto[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) change_note?: string;
}

export class AplicarChecklistDto {
  @IsUUID() template_version_id!: string;
  @IsOptional() @IsUUID() company_unit_id?: string;
}

export class ResponderItemDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) value!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}
