import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Matches, Min } from 'class-validator';

export class UpdateInspectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dds_topic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dds_participants_count?: number;

  @IsOptional()
  @IsString()
  dds_notes?: string;

  @IsOptional()
  @IsString()
  general_recommendations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  technician_signature_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_signature_name?: string;

  @IsOptional()
  // String vazia (campo esvaziado via onBlur no <input type="time">) vira
  // null antes de validar — @IsOptional() trata null/undefined como
  // "ausente" e pula o @Matches (senão "" cairia na regex e voltaria
  // 400, tornando impossível esvaziar o campo pela UI). Precisa ser
  // null (não undefined): buildSafeSetClause descarta chaves com valor
  // undefined (tratadas como "não mexer nesse campo"), então só null
  // sobrevive pra virar `SET started_at = NULL` de verdade.
  @Transform(({ value }) => (value === '' ? null : value))
  @Matches(/^\d{2}:\d{2}$/, { message: 'started_at deve estar no formato HH:MM' })
  started_at?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @Matches(/^\d{2}:\d{2}$/, { message: 'ended_at deve estar no formato HH:MM' })
  ended_at?: string | null;
}
