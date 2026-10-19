import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const TABLE_CODE = /^\d{9}$/;
const HHMM = /^([01]\d|2[0-3])[0-5]\d$/;
const msgTable = 'deve ter 9 dígitos (código da tabela oficial do eSocial)';

// Dados da CAT 1:1 com o leiaute evtCAT. Os códigos das Tabelas 13, 14, 15 e 17 e o CID são informados
// por quem emite a CAT; o sistema não adivinha. O funcionário vem no corpo mas é conferido sob RLS.
export class AccidentDto {
  @IsUUID() employeeId!: string;

  @IsDateString() acidDate!: string;
  @IsIn([1, 2, 3]) acidType!: 1 | 2 | 3; // 1 típico, 2 doença, 3 trajeto
  @IsOptional() @Matches(HHMM, { message: 'acidTime deve ser HHMM (0000 a 2359)' }) acidTime?: string;
  @IsOptional() @Matches(/^\d{2}[0-5]\d$/, { message: 'hoursWorkedBefore deve ser HHMM (até 9959)' }) hoursWorkedBefore?: string;
  @IsIn([1, 2, 3]) catType!: 1 | 2 | 3; // 1 inicial, 2 reabertura, 3 óbito
  @IsBoolean() death!: boolean;
  @IsOptional() @IsDateString() deathDate?: string;
  @IsBoolean() policeNotified!: boolean;
  @Matches(TABLE_CODE, { message: `causingSituationCode ${msgTable} (Tabela 15)` }) causingSituationCode!: string;
  @IsIn([1, 2, 3]) catInitiative!: 1 | 2 | 3; // 1 empregador, 2 ordem judicial, 3 órgão fiscalizador
  @IsOptional() @IsString() @MaxLength(999) catNotes?: string;
  @IsOptional() @IsDateString() lastWorkDay?: string;
  @IsOptional() @IsBoolean() hadLeave?: boolean;

  @IsIn([1, 2, 3, 4, 5, 6, 9]) locationType!: 1 | 2 | 3 | 4 | 5 | 6 | 9;
  @IsOptional() @IsString() @MaxLength(255) locationDescription?: string;
  @IsOptional() @IsString() @MaxLength(4) locStreetType?: string;
  @IsString() @MinLength(1) @MaxLength(100) locStreet!: string;
  @IsString() @MinLength(1) @MaxLength(10) locNumber!: string;
  @IsOptional() @IsString() @MaxLength(30) locComplement?: string;
  @IsOptional() @IsString() @MaxLength(90) locDistrict?: string;
  @IsOptional() @Matches(/^\d{8}$/, { message: 'locCep deve ter 8 dígitos' }) locCep?: string;
  @IsOptional() @Matches(/^\d{7}$/, { message: 'locCityCode deve ter 7 dígitos (IBGE)' }) locCityCode?: string;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) locUf?: string;
  @IsOptional() @Matches(/^\d{3}$/, { message: 'locCountry deve ter 3 dígitos' }) locCountry?: string;
  @IsOptional() @IsString() @MaxLength(12) locPostalCode?: string;
  @IsOptional() @IsIn([1, 3, 4]) locInscriptionType?: 1 | 3 | 4;
  @IsOptional() @Matches(/^[A-Za-z0-9]{12,14}$/, { message: 'locInscriptionNumber deve ter 12 a 14 caracteres' }) locInscriptionNumber?: string;

  @Matches(TABLE_CODE, { message: `bodyPartCode ${msgTable} (Tabela 13)` }) bodyPartCode!: string;
  @IsIn([0, 1, 2, 3]) laterality!: 0 | 1 | 2 | 3; // 0 não aplicável, 1 esquerda, 2 direita, 3 ambas
  @Matches(TABLE_CODE, { message: `causingAgentCode ${msgTable} (Tabela 14)` }) causingAgentCode!: string;

  @IsDateString() attDate!: string;
  @Matches(HHMM, { message: 'attTime deve ser HHMM' }) attTime!: string;
  @IsBoolean() attHospitalized!: boolean;
  @Type(() => Number) @IsInt() @Min(0) @Max(9999) attTreatmentDays!: number;
  @IsBoolean() attLeave!: boolean;
  @Matches(TABLE_CODE, { message: `attInjuryCode ${msgTable} (Tabela 17)` }) attInjuryCode!: string;
  @IsOptional() @IsString() @MaxLength(200) attInjuryDetail?: string;
  @IsOptional() @IsString() @MaxLength(100) attProbableDiagnosis?: string;
  @Matches(/^[A-Za-z0-9]{3,4}$/, { message: 'attCid deve ter 3 ou 4 caracteres (CID)' }) attCid!: string;
  @IsOptional() @IsString() @MaxLength(255) attNotes?: string;
  @IsString() @MinLength(2) @MaxLength(70) attIssuerName!: string;
  @IsIn([1, 2, 3]) attIssuerCouncil!: 1 | 2 | 3; // 1 CRM, 2 CRO, 3 RMS
  @IsString() @MinLength(1) @MaxLength(14) attIssuerNumber!: string;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) attIssuerUf?: string;

  @IsOptional() @IsUUID() originEventId?: string;
}
