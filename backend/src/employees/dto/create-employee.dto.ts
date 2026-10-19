import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_ONLY, NO_NUL } from '../../epi/dto/epi-dto-rules';
import { BlankToNull, OnlyDigits, Trim } from './employee-dto-rules';

// Validadores reais de class-validator (o ValidationPipe global usa whitelist + forbidNonWhitelisted:
// propriedade sem decorator é rejeitada). A validação do serviço e do banco continua como defesa em profundidade.
export class CreateEmployeeDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(200) @Matches(NO_NUL) full_name: string;
  // Aceita com máscara; grava só dígitos.
  @OnlyDigits() @IsString() @Matches(/^\d{11}$/) cpf: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) birth_date?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) position?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) admission_date?: string;
  @BlankToNull() @IsOptional() @IsUUID() company_unit_id?: string;
  // Ficha de EPI: vazio vira null.
  @BlankToNull() @IsOptional() @IsString() @MaxLength(30) @Matches(NO_NUL) registration_number?: string;
  @BlankToNull() @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) department?: string;
  // Só é lido quando quem cria é role admin (empresa usa sempre o próprio tenant_id do token).
  @IsOptional() @IsUUID() tenant_id?: string;
}
