import { IsISO8601, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEpiDeliveryDto {
  @IsUUID()
  employee_id: string;

  @IsISO8601()
  delivered_at: string;

  @IsString()
  @MaxLength(200)
  signed_by_name: string;
}
