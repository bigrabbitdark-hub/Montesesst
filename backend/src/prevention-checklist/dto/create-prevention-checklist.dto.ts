import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CreatePreventionChecklistDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data_realizacao: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // não pode criar checklist — mesmo padrão de resolução de tenant_id
  // já usado nos sub-projetos A/B, mas aqui o papel 'empresa' nunca
  // chega a esta rota por causa do @Roles do controller).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
