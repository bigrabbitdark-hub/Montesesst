import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CATEGORIAS, RuleCategoria } from '../normative-rule-areas';
import { METODOS } from './create-normative-rule.dto';

// Sem rule_key, sem area e sem status: chave e área são imutáveis e o status só muda por review()/retire().
// categoria pode mudar só DENTRO da área da regra (o serviço rejeita com 400 uma categoria de outra área).
// Colunas NOT NULL usam ValidateIf(!== undefined) em vez de IsOptional: omitir é permitido, mas `null`
// é validado (e rejeitado, 400) em vez de chegar ao banco como NULL (500) ou jsonb 'null'.
// unidade, excecoes e vigencia_* são anuláveis e continuam aceitando null.
const sePresente = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined);

export class UpdateNormativeRuleDto {
  @sePresente() @IsIn(CATEGORIAS)
  categoria?: RuleCategoria;

  @sePresente() @IsString() @IsNotEmpty() @MaxLength(300)
  agente_ou_atividade?: string;

  @sePresente() @IsIn(METODOS)
  metodo_avaliacao?: (typeof METODOS)[number];

  @IsOptional() @IsString() @MaxLength(100)
  unidade?: string;

  @sePresente() @IsString() @IsNotEmpty() @MaxLength(5000)
  criterio?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  excecoes?: string;

  @sePresente() @IsArray() @ArrayMaxSize(50)
  dependencias?: unknown[];

  @sePresente() @IsString() @IsNotEmpty() @MaxLength(10000)
  interpretacao?: string;

  @sePresente() @IsBoolean()
  exige_revisao_profissional?: boolean;

  @IsOptional() @IsDateString()
  vigencia_inicio?: string;

  @IsOptional() @IsDateString()
  vigencia_fim?: string;
}
