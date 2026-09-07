import { IsArray, IsUUID } from 'class-validator';

export class SetEpiRequirementsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  epi_catalog_item_ids: string[];
}
