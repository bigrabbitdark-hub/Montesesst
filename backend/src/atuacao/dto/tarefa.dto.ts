import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsDataReal } from './validators';
import { TAREFA_PRIORIDADES, TAREFA_STATUS } from '../tarefa-status';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Em PATCH, undefined = campo ausente; null NÃO é "ausente": cai nos validadores e dá 400.
const quandoPresente = () => ValidateIf((_o, v) => v !== undefined);

export class CreateTarefaDto {
  @IsUUID() tenant_id!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(TAREFA_PRIORIDADES as unknown as string[]) priority?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() due_date?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsUUID() assignee_user_id!: string;
}

export class UpdateTarefaDto {
  @quandoPresente() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @quandoPresente() @IsString() @MaxLength(4000) description?: string;
  @quandoPresente() @IsIn(TAREFA_PRIORIDADES as unknown as string[]) priority?: string;
  @quandoPresente() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDataReal() due_date?: string;
  @quandoPresente() @IsString() @MaxLength(100) category?: string;
  @quandoPresente() @IsUUID() assignee_user_id?: string;
}

export class ChangeTarefaStatusDto {
  @IsIn(TAREFA_STATUS as unknown as string[]) status!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListTarefasQuery {
  @IsOptional() @IsString() @MaxLength(40) assignee?: string; // 'me' ou uuid
  @IsOptional() @IsIn(TAREFA_STATUS as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsIn(['true']) vencidas?: string;
}
