import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateActionPlanDto {
  @IsOptional()
  // Mesmo raciocínio de update-inspection.dto.ts (started_at/ended_at):
  // "" precisa virar null (não undefined) pra sobreviver ao filtro de
  // buildSafeSetClause e realmente limpar o prazo no banco, em vez de
  // só evitar o 400 do @IsISO8601 sem persistir nada.
  @Transform(({ value }) => (value === '' ? null : value))
  @IsISO8601()
  deadline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsible?: string;

  @IsOptional()
  @IsIn(['pendente', 'resolvido'])
  status?: 'pendente' | 'resolvido';
}
