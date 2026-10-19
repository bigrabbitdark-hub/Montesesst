import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';
import { NO_NUL } from '../../epi/dto/epi-dto-rules';
import { PublicOpenDto } from './public-open.dto';

// 200 KB de PNG em base64 = 273.068 caracteres; 300.000 deixa folga e é o teto antes de qualquer decodificação.
export const MAX_SIGNATURE_BASE64_CHARS = 300_000;

export class PublicSignDto extends PublicOpenDto {
  @IsBoolean() accepted: boolean;
  @IsString() @MaxLength(32) @Matches(NO_NUL) term_version: string;
  @IsString() @MaxLength(MAX_SIGNATURE_BASE64_CHARS) @Matches(/^[A-Za-z0-9+/]+={0,2}$/) signature_png_base64: string;
}
