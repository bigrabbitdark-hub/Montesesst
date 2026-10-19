import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const EPI_STOCK_BANDS = ['sem_estoque', 'abaixo', 'otimo', 'acima'] as const;
export const EPI_CA_ALERTS = ['vencido', 'a_vencer', 'ok', 'sem_validade'] as const;
export const EPI_STATUSES = ['ativo', 'inativo'] as const;
export const EPI_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

// Só inteiro decimal puro; o resto continua string e é rejeitado pelo @IsInt (400, nunca 500).
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;

// Parâmetro repetido chega como array e falha nos validadores de string/IsIn.
export class SearchEpisQueryDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[^\u0000]*$/) q?: string;
  @IsOptional() @IsIn(EPI_STATUSES) status?: (typeof EPI_STATUSES)[number];
  @IsOptional() @IsIn(EPI_CATEGORIES) category?: (typeof EPI_CATEGORIES)[number];
  @IsOptional() @IsIn(EPI_STOCK_BANDS) stock_band?: (typeof EPI_STOCK_BANDS)[number];
  @IsOptional() @IsIn(EPI_CA_ALERTS) ca_alert?: (typeof EPI_CA_ALERTS)[number];
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) page_size?: number;
}
