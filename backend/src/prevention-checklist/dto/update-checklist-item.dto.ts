import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsIn(['C', 'NC', 'NA'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;
}
