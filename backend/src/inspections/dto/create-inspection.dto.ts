import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  tenant_id: string;

  @IsISO8601()
  visited_at: string;

  @IsUUID()
  company_unit_id: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'started_at deve estar no formato HH:MM' })
  started_at?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'ended_at deve estar no formato HH:MM' })
  ended_at?: string;
}
