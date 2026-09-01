import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateVisitDto {
  @IsUUID()
  technician_user_id: string;

  @IsOptional()
  @IsISO8601()
  preferred_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
