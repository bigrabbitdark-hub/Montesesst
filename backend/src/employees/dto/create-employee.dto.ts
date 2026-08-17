export class CreateEmployeeDto {
  full_name: string;
  cpf: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  // Só é lido quando quem cria é role admin (empresa usa sempre o próprio tenant_id do token).
  tenant_id?: string;
}
