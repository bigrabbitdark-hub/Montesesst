import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_ONLY, NO_NUL } from '../../epi/dto/epi-dto-rules';
import { BlankToNull, IsCboInput, IsCpf, IsRegistrationNumber, OnlyDigits, Trim } from './employee-dto-rules';

// Validadores reais de class-validator (o ValidationPipe global usa whitelist + forbidNonWhitelisted:
// propriedade sem decorator é rejeitada). O serviço revalida e normaliza tudo com normalizeEmployeeInput
// (employee-fields.util.ts) e o banco tem CHECKs: defesa em profundidade, sempre 400 e nunca 500.
export class CreateEmployeeDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(200) @Matches(NO_NUL) full_name: string;
  // Aceita com máscara; grava só dígitos. Exige dígito verificador válido.
  @OnlyDigits() @IsString() @IsCpf() cpf: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) birth_date?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) position?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) admission_date?: string;
  @BlankToNull() @IsOptional() @IsUUID() company_unit_id?: string;
  // Matrícula (eSocial e ficha de EPI): vazio vira null.
  @BlankToNull() @IsOptional() @IsString() @MaxLength(30) @IsRegistrationNumber() registration_number?: string;
  // Setor (ficha de EPI): vazio vira null.
  @BlankToNull() @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) department?: string;
  // Só é lido quando quem cria é role admin (empresa usa sempre o próprio tenant_id do token).
  @IsOptional() @IsUUID() tenant_id?: string;

  // Campos do modelo oficial: formato validado e normalizado por normalizeEmployeeInput
  // (sexo 'f'/'m' vira 'F'/'M'; CBO aceita número e recupera o zero à esquerda).
  // Formato fino (F/M, 6 dígitos) em normalizeEmployeeInput; aqui tipo e tamanho (objeto/array => 400).
  @IsOptional() @IsString() @MaxLength(20) @Matches(NO_NUL) sex?: string;
  @IsOptional() @IsCboInput() cbo_code?: string | number;
  @IsOptional() @IsString() @MaxLength(2000) @Matches(NO_NUL) activity_description?: string;
}
