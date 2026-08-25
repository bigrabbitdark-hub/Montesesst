import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsIn(['C', 'NC', 'NA'])
  status?: 'C' | 'NC' | 'NA';

  @IsOptional()
  @IsString()
  notes?: string;
}
