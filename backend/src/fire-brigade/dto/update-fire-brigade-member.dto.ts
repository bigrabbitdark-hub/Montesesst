import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FUNCAO_BRIGADA_VALUES } from '../fire-brigade.service';

export class UpdateFireBrigadeMemberDto {
  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsIn(FUNCAO_BRIGADA_VALUES)
  funcao_brigada?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  turno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @IsOptional()
  @IsIn(['ativo', 'inativo'])
  status?: string;
}
