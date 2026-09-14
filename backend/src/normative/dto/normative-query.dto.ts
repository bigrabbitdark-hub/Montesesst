import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class NormativeQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;

  // Só é lido quando quem chama é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de
  // RunPenteFinoDto (Fase 25). Opcional: sem ele, a pergunta continua
  // puramente normativa, comportamento idêntico ao de sempre.
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
