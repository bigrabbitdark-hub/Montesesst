import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMemberDto {
  @IsUUID()
  company_unit_id: string;

  @IsString()
  @MaxLength(200)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  funcao_empresa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  setor?: string;

  @IsIn(['presidente', 'vice_presidente', 'secretario', 'membro'])
  funcao_cipa: string;

  @IsIn(['titular', 'suplente'])
  titular_suplente: string;

  @IsIn(['empregador', 'empregados'])
  representacao: string;

  @IsISO8601()
  inicio_mandato: string;

  @IsISO8601()
  fim_mandato: string;
}
