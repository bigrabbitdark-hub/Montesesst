import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SST_NR_CATEGORIES } from './create-sst-checklist-item.dto';

export class UpdateSstChecklistItemDto {
  @IsOptional()
  @IsString()
  nr_code?: string;

  @IsOptional()
  @IsString()
  nr_title?: string;

  @IsOptional()
  @IsIn(SST_NR_CATEGORIES)
  nr_category?: string;

  @IsOptional()
  @IsString()
  document_name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  legal_requirement?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  infraction_index?: number;
}
