import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const EXAM_TYPES = [
  'admissional', 'periodico', 'retorno_trabalho', 'mudanca_funcao',
  'monitoracao_pontual', 'demissional',
] as const;

export class CreateAsoRecordDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(EXAM_TYPES)
  examType!: (typeof EXAM_TYPES)[number];

  @IsDateString()
  examDate!: string;

  @IsIn(['apto', 'inapto'])
  result!: 'apto' | 'inapto';

  @IsBoolean()
  resultDisclosureAuthorized!: boolean;

  @IsString()
  doctorName!: string;

  @IsString()
  doctorCrm!: string;

  @Length(2, 2)
  doctorCrmUf!: string;

  @IsOptional()
  @IsUUID()
  pcmsoPhysicianId?: string;
}
