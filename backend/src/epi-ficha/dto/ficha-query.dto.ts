import { IsIn, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { DATE_ONLY } from '../../epi/dto/epi-dto-rules';
import { SIGNATURE_STATUSES } from '../epi-ficha.types';

// Parâmetro repetido chega como array e falha em @IsString; desconhecido cai no forbidNonWhitelisted.
export class FichaQueryDto {
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsString() @IsIn(SIGNATURE_STATUSES as unknown as string[]) signature_status?: string;
}
