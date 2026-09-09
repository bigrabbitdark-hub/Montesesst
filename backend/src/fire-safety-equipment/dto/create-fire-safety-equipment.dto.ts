import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EQUIPMENT_TYPES } from '../fire-safety-equipment.service';

export class CreateFireSafetyEquipmentDto {
  @IsIn(EQUIPMENT_TYPES)
  tipo: string;

  @IsString()
  @MaxLength(100)
  codigo: string;

  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  localizacao?: string;

  @IsOptional()
  @IsISO8601()
  data_instalacao?: string;

  @IsOptional()
  @IsISO8601()
  data_ultima_manutencao?: string;

  @IsOptional()
  @IsISO8601()
  proxima_manutencao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  empresa_responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  agente_extintor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  capacidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  classe_fogo?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de CreateEpiDto.
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
