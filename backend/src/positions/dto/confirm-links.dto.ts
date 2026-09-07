import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class ConfirmLinksGroupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  suggested_name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  employee_ids: string[];

  // Não usado pelo service (confirmLinks só lê suggested_name/employee_ids)
  // — mas precisa estar whitelisted aqui: tanto o frontend real
  // (MapaSstPanel.handleConfirmLinks) quanto o teste e2e existente
  // reenviam o item de LinkSuggestion inteiro, como veio de
  // GET /positions/link-suggestions, e esse objeto sempre inclui
  // employee_count. Sem este campo, forbidNonWhitelisted rejeitaria com
  // 400 toda confirmação de vínculo feita pela UI de verdade (achado
  // durante a suíte e2e desta correção, não estava no brief original).
  @IsOptional()
  @IsInt()
  employee_count?: number;
}

export class ConfirmLinksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmLinksGroupDto)
  groups: ConfirmLinksGroupDto[];
}
