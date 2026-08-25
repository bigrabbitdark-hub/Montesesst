import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateEpiDto {
  @IsUUID()
  epi_catalog_item_id: string;

  @IsString()
  @MaxLength(100)
  ca_number: string;

  @IsOptional()
  @IsISO8601()
  ca_valid_until?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
