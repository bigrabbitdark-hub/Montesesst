import { IsOptional, IsUUID } from 'class-validator';

export class RunPenteFinoDto {
  // Só é lido quando quem chama é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de
  // CreateDocumentDto (Fase 4).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
