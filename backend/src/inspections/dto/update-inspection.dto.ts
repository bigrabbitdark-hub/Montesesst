import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
}
