import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Só inteiro decimal puro; o resto continua string e é rejeitado pelo @IsInt (400, nunca 500).
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;

export class ListPendingQueryDto {
  @IsOptional() @IsUUID() tenant_id?: string;
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) page_size?: number;
}
