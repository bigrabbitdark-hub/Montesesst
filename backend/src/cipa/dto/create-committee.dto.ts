import { IsInt, IsISO8601, IsUUID, Max, Min } from 'class-validator';

export class CreateCommitteeDto {
  @IsUUID()
  company_unit_id: string;

  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsISO8601()
  data_inicio: string;

  @IsISO8601()
  data_termino: string;

  @IsUUID()
  responsavel_user_id: string;
}
