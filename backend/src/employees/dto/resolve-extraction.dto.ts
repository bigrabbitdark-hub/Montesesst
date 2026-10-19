import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ResolveDecisionDto {
  @IsInt({ message: 'line deve ser um número inteiro' })
  @Min(1, { message: 'line deve ser 1 ou maior' })
  line: number;

  @IsIn(['aplicar', 'ignorar'], { message: 'action deve ser "aplicar" ou "ignorar"' })
  action: 'aplicar' | 'ignorar';

  // Só vale para conflito + aplicar; a regra fina é validada no serviço.
  @IsOptional()
  @IsArray({ message: 'fields deve ser uma lista de campos' })
  @ArrayMaxSize(20, { message: 'fields tem itens demais' })
  @IsString({ each: true, message: 'cada item de fields deve ser texto' })
  fields?: string[];
}

export class ResolveExtractionDto {
  @IsArray({ message: 'decisions deve ser uma lista' })
  @ArrayMaxSize(2000, { message: 'decisions aceita no máximo 2000 itens' })
  @ValidateNested({ each: true })
  @Type(() => ResolveDecisionDto)
  decisions: ResolveDecisionDto[];
}
