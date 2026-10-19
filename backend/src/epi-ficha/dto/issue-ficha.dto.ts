import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_ONLY, NO_NUL } from '../../epi/dto/epi-dto-rules';
import { SIGNATURE_STATUSES } from '../epi-ficha.types';

// Corpo da emissão: chave de idempotência obrigatória + os mesmos filtros opcionais da ficha.
// O tenant nunca vem do corpo (é lido da linha do funcionário sob RLS).
export class IssueFichaDto {
  @IsString() @MinLength(8) @MaxLength(100) @Matches(NO_NUL) idempotency_key: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsString() @IsIn(SIGNATURE_STATUSES as unknown as string[]) signature_status?: string;
}
