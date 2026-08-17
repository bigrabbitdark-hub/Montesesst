export class AssignPartnerDto {
  // Só é lido quando quem chama é role admin (empresa sempre usa o próprio tenant_id do token).
  tenant_id?: string;
}
