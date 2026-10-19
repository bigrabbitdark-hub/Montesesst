import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { DATE_ONLY, INT_MAX, MONEY_MAX, NO_NUL } from './epi-dto-rules';

// Edição parcial do cadastro de EPI. Não inclui epi_catalog_item_id, tenant_id nem
// stock_balance: com forbidNonWhitelisted esses campos viram 400 (o saldo só muda por movimentação).
//
// Limpar um campo: os opcionais NULLÁVEIS (ca_valid_until, manufacturer, model, min_stock,
// max_stock, unit_cost, replacement_days) aceitam `null` explícito e gravam NULL (@IsOptional
// ignora null/undefined; ausência da chave = não altera). Os campos NOT NULL (ca_number, unit,
// controls_lot, status) não aceitam null: sem isso o UPDATE falharia com 500.
export class UpdateEpiDto {
  @ValidateIf((o) => o.ca_number !== undefined)
  @IsString() @MinLength(1) @MaxLength(100) @Matches(NO_NUL)
  ca_number?: string;

  // Só 'AAAA-MM-DD' (formas ISO parciais como ano ou semana viram 500 no cast para date).
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) ca_valid_until?: string | null;

  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) manufacturer?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) model?: string | null;

  @ValidateIf((o) => o.unit !== undefined)
  @IsString() @MinLength(1) @MaxLength(20) @Matches(NO_NUL)
  unit?: string;

  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) min_stock?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) max_stock?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MONEY_MAX) unit_cost?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(INT_MAX) replacement_days?: number | null;

  @ValidateIf((o) => o.controls_lot !== undefined)
  @IsBoolean()
  controls_lot?: boolean;

  @ValidateIf((o) => o.status !== undefined)
  @IsIn(['ativo', 'inativo'])
  status?: 'ativo' | 'inativo';
}
