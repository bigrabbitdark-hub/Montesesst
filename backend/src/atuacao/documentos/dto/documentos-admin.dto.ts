import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { CATEGORIAS_DOCUMENTO } from './documentos.dto';

export const ACOES_MATRIZ = ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class MatrizQuery {
  @IsOptional() @IsIn(CATEGORIAS_DOCUMENTO as unknown as string[]) category?: string;
}

// Substitui o conjunto do par (categoria, usuário). Vazio remove tudo.
export class SetMatrizDto {
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsIn(ACOES_MATRIZ as unknown as string[], { each: true })
  acoes!: string[];
}

export class RegistrosQuery {
  @IsOptional() @IsUUID() userId?: string;
}

export class CreateRegistroDto {
  @IsUUID() user_id!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(20) council!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30) registration_number!: string;
  @Transform(trim) @IsString() @Length(2, 2) @Matches(/^[A-Z]{2}$/) uf!: string;
}
