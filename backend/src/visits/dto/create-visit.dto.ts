import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateVisitDto {
  @IsUUID()
  technician_user_id: string;

  @IsIn(['reuniao', 'visita'])
  type: 'reuniao' | 'visita';

  @IsOptional()
  @IsISO8601()
  preferred_date?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'preferred_time deve estar no formato HH:MM' })
  preferred_time?: string;

  @ValidateIf((dto) => dto.type === 'visita')
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
