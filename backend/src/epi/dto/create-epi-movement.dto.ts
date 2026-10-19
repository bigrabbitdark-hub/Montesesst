import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DATE_ONLY, DATE_OR_DATETIME, NO_NUL } from './epi-dto-rules';

export const REGISTERABLE_TYPES = ['abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa'] as const;

export class CreateEpiMovementDto {
  @IsIn(REGISTERABLE_TYPES)
  type: (typeof REGISTERABLE_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(NO_NUL)
  supplier?: string;

  @IsOptional()
  @IsUUID()
  lot_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(NO_NUL)
  lot_code?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  lot_valid_until?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(NO_NUL)
  reason?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_OR_DATETIME)
  @IsISO8601({ strict: true })
  occurred_at?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(NO_NUL)
  idempotency_key: string;
}
