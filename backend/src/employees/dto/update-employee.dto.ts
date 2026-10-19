import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { DATE_ONLY, NO_NUL } from '../../epi/dto/epi-dto-rules';
import { BlankToNull, IsCpf, IsRegistrationNumber, OnlyDigits, Trim } from './employee-dto-rules';

// Edição parcial. Ausência da chave = não altera. `null` só é aceito nos campos anuláveis (limpa o campo, via
// @IsOptional); full_name, cpf e status são NOT NULL e não aceitam null (sem isso o UPDATE falharia com 500).
// O serviço revalida e normaliza com normalizeEmployeeInput (employee-fields.util.ts).
export class UpdateEmployeeDto {
  @ValidateIf((o) => o.full_name !== undefined)
  @Trim() @IsString() @MinLength(1) @MaxLength(200) @Matches(NO_NUL)
  full_name?: string;

  @ValidateIf((o) => o.cpf !== undefined)
  @OnlyDigits() @IsString() @IsCpf()
  cpf?: string;

  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) birth_date?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) position?: string | null;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) admission_date?: string | null;
  @BlankToNull() @IsOptional() @IsUUID() company_unit_id?: string | null;
  @BlankToNull() @IsOptional() @IsUUID() position_id?: string | null;

  @ValidateIf((o) => o.status !== undefined)
  @IsIn(['ativo', 'inativo', 'pendente'])
  status?: 'ativo' | 'inativo' | 'pendente';

  // Matrícula (eSocial e ficha de EPI) e setor: vazio/só espaços vira null.
  @BlankToNull() @IsOptional() @IsString() @MaxLength(30) @IsRegistrationNumber() registration_number?: string | null;
  @BlankToNull() @IsOptional() @IsString() @MaxLength(120) @Matches(NO_NUL) department?: string | null;

  // Campos do modelo oficial: formato validado e normalizado por normalizeEmployeeInput.
  @IsOptional() sex?: string | null;
  @IsOptional() cbo_code?: string | null;
  @IsOptional() activity_description?: string | null;
}
