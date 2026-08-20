export class UpdateEmployeeDto {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  status?: 'ativo' | 'inativo' | 'pendente';
}
