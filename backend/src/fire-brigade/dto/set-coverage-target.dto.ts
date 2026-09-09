import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class SetCoverageTargetDto {
  @IsUUID()
  company_unit_id: string;

  @IsInt()
  @Min(0)
  quantidade_necessaria: number;

  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
