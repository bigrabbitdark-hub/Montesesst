import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCandidateDto {
  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome_livre?: string;
}
