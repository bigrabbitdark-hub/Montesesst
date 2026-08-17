export class UpdateTechnicianDto {
  registration_number?: string;
  specialization?: string;
  status?: 'ativo' | 'inativo' | 'pendente';
}
