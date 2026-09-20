import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { SST_NR_CATEGORIES } from './create-sst-checklist-item.dto';

// @IsOptional() fica SEMPRE como primeiro decorator: null/ausente continuam
// sendo no-op (os validators seguintes são pulados) e só string vazia é
// rejeitada pelo @IsNotEmpty() — as colunas são NOT NULL e gravar vazio
// dispararia um re-embedding degradado.
export class UpdateSstChecklistItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nr_code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nr_title?: string;

  @IsOptional()
  @IsIn(SST_NR_CATEGORIES)
  nr_category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  document_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legal_requirement?: string;

  // null limpa o índice (o frontend manda null ao esvaziar o campo).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  infraction_index?: number | null;
}
