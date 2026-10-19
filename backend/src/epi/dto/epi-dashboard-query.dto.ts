import { IsISO8601, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { DATE_ONLY } from './epi-dto-rules';

// Parâmetro repetido chega como array e falha em @IsString (400).
export class EpiDashboardQueryDto {
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsUUID() epi_id?: string;
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @IsUUID() tenant_id?: string;
}

export class TenantOnlyQueryDto {
  @IsOptional() @IsUUID() tenant_id?: string;
}
