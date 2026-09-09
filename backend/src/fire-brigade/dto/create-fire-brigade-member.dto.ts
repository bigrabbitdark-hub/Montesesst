import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FUNCAO_BRIGADA_VALUES } from '../fire-brigade.service';

export class CreateFireBrigadeMemberDto {
  @IsUUID()
  employee_id: string;

  @IsUUID()
  company_unit_id: string;

  @IsIn(FUNCAO_BRIGADA_VALUES)
  funcao_brigada: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  turno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de
  // CreateFireSafetyEquipmentDto/CreateEpiDto.
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
