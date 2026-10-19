// Body do PATCH /api/documents/:id/validity.
// Aceita as duas datas como 'AAAA-MM-DD' ou null. A validação de calendário
// e a coerência (expires_at >= valid_from) ficam na função pura
// mergeValidityPatch — aqui só declaramos o formato e a obrigatoriedade da
// presença das chaves (com forbidNonWhitelisted do controller). O controller
// complementa a validação de formato (isDateOnly) e checa body vazio.
import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateDocumentValidityDto {
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsOptional()
  // @ValidateIf já faz o "ou null ou string"; o controller valida o formato
  // isDateOnly antes de chegar no service. Não usamos @IsISO8601 porque ele
  // aceita timestamp com hora/fuso.
  valid_from?: string | null;

  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsOptional()
  expires_at?: string | null;
}