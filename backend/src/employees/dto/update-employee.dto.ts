export class UpdateEmployeeDto {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  status?: 'ativo' | 'inativo' | 'pendente';
}
