import {
  IsBoolean, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { DATE_ONLY, INT_MAX, MONEY_MAX, NO_NUL } from './epi-dto-rules';

export class CreateEpiDto {
  @IsUUID()
  epi_catalog_item_id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(NO_NUL)
  ca_number: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  ca_valid_until?: string;

  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) model?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) @Matches(NO_NUL) unit?: string;
  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) min_stock?: number;
  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) max_stock?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MONEY_MAX) unit_cost?: number;
  @IsOptional() @IsBoolean() controls_lot?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(INT_MAX) replacement_days?: number;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
