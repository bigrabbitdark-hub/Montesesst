import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const FILTROS_ORIGEM = ['all', 'automatica', 'explicita', 'fora'] as const;

export class ListarCarteiraQuery {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(FILTROS_ORIGEM as unknown as string[])
  origem?: (typeof FILTROS_ORIGEM)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page?: number;
}

export class MarcarCarteiraDto {
  // null/"" limpam a nota; ausente mantém a existente.
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(500)
  note?: string | null;
}
