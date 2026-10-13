import { Type } from 'class-transformer';
import { IsArray, IsObject, IsString, ValidateNested } from 'class-validator';

export class BulkEmployeeChangeDto {
  @IsString()
  id: string;

  @IsString()
  row_version: string;

  // As chaves aceitas são decididas por normalizeEmployeeInput (allowlist); o resto é ignorado.
  @IsObject()
  fields: Record<string, unknown>;
}

export class BulkUpdateEmployeesDto {
  // O limite de 1 a 200 mudanças é validado no serviço (resposta 400 em português).
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkEmployeeChangeDto)
  changes: BulkEmployeeChangeDto[];
}
