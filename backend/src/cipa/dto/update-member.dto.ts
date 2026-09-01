import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMemberDto {
  @IsOptional() @IsString() @MaxLength(200) nome?: string;
  @IsOptional() @IsString() @MaxLength(200) funcao_empresa?: string;
  @IsOptional() @IsString() @MaxLength(200) setor?: string;
  @IsOptional() @IsIn(['presidente', 'vice_presidente', 'secretario', 'membro']) funcao_cipa?: string;
  @IsOptional() @IsIn(['titular', 'suplente']) titular_suplente?: string;
  @IsOptional() @IsIn(['empregador', 'empregados']) representacao?: string;
  @IsOptional() @IsISO8601() inicio_mandato?: string;
  @IsOptional() @IsISO8601() fim_mandato?: string;
  @IsOptional() @IsIn(['ativo', 'inativo']) status?: string;
}
