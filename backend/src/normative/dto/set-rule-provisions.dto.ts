import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';

export class RuleProvisionLinkDto {
  @IsUUID()
  provision_id: string;

  @IsIn(['fundamento', 'criterio', 'excecao', 'metodo'])
  papel: 'fundamento' | 'criterio' | 'excecao' | 'metodo';
}

export class SetRuleProvisionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RuleProvisionLinkDto)
  links: RuleProvisionLinkDto[];
}
