import { IsOptional, Matches, ValidateIf } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Só colunas de vigência: qualquer outro campo é recusado (forbidNonWhitelisted).
export class VigenciaDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA, { message: 'valid_from inválida (esperado AAAA-MM-DD)' })
  valid_from?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA, { message: 'expires_at inválida (esperado AAAA-MM-DD)' })
  expires_at?: string | null;
}
