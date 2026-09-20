import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export const SST_NR_CATEGORIES = ['geral', 'especial', 'setorial', 'revogada'] as const;

export class CreateSstChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  nr_code: string;

  @IsString()
  @IsNotEmpty()
  nr_title: string;

  @IsIn(SST_NR_CATEGORIES)
  nr_category: string;

  @IsString()
  @IsNotEmpty()
  document_name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  legal_requirement: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  infraction_index?: number;
}
