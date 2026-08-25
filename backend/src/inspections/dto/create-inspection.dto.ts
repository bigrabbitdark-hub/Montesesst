import { IsISO8601, IsUUID } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  tenant_id: string;

  @IsISO8601()
  visited_at: string;
}
