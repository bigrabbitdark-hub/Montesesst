import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

import { DATE_OR_DATETIME } from './epi-dto-rules';

export const LEDGER_TYPES = ['abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa', 'ajuste', 'estorno'] as const;

// Só aceita inteiro decimal puro (sem notação científica, sinal ou Infinity); o resto
// continua string e é rejeitado pelo @IsInt.
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;

export class ListEpiMovementsQueryDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  @IsOptional() @IsUUID() tenant_epi_id?: string;
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @IsIn(LEDGER_TYPES) type?: (typeof LEDGER_TYPES)[number];
  // Parâmetro repetido chega como array e falha em @IsString.
  @IsOptional() @IsString() @Matches(DATE_OR_DATETIME) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_OR_DATETIME) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) page_size?: number;
}
