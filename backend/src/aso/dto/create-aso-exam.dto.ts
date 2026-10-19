import { IsDateString, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateAsoExamDto {
  // Código da Tabela 27 do eSocial (procedimentos diagnósticos), 4 dígitos.
  @Matches(/^\d{4}$/, { message: 'procedureCode deve ter 4 dígitos (Tabela 27 do eSocial)' })
  procedureCode!: string;

  @IsString()
  @Length(2, 200)
  procedureName!: string;

  @IsDateString()
  examDate!: string;

  // 1 inicial, 2 sequencial. Obrigatório quando procedureCode = 0281 (validado no diagnóstico).
  @IsOptional()
  @IsIn([1, 2])
  orderExam?: 1 | 2;

  // Descrição de procedimento fora da tabela (usada com o código 9999). Máx. 999 no leiaute.
  @IsOptional()
  @IsString()
  @MaxLength(999)
  obsProc?: string;
}
