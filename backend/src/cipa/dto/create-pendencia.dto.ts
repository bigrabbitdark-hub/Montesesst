import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePendenciaDto {
  @IsUUID()
  company_unit_id: string;

  @IsOptional()
  @IsUUID()
  meeting_id?: string;

  @IsString()
  @MaxLength(1000)
  descricao: string;

  @IsOptional()
  @IsUUID()
  responsavel_user_id?: string;

  @IsOptional()
  @IsISO8601()
  prazo?: string;

  @IsOptional()
  @IsIn(['alta', 'media', 'baixa'])
  prioridade?: string;
}
