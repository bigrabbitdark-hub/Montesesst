import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AREAS, CATEGORIAS, RuleArea, RuleCategoria } from '../normative-rule-areas';

export const METODOS = ['quantitativo', 'qualitativo', 'misto', 'nao_aplicavel'] as const;

export class CreateNormativeRuleDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_.-]{2,79}$/, { message: 'rule_key deve ter 3-80 caracteres: A-Z, 0-9, _ . -' })
  rule_key: string;

  // Imutável depois do cadastro (o DTO de edição não tem `area`).
  @IsIn(AREAS)
  area: RuleArea;

  // Formato aqui; a coerência area × categoria é validada no serviço (400) e no CHECK do banco.
  @IsIn(CATEGORIAS)
  categoria: RuleCategoria;

  @IsString() @IsNotEmpty() @MaxLength(300)
  agente_ou_atividade: string;

  @IsIn(METODOS)
  metodo_avaliacao: (typeof METODOS)[number];

  @IsOptional() @IsString() @MaxLength(100)
  unidade?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  criterio: string;

  @IsOptional() @IsString() @MaxLength(5000)
  excecoes?: string;

  // Omitir vira [] no serviço; null explícito é rejeitado (400) em vez de virar jsonb 'null'.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined) @IsArray() @ArrayMaxSize(50)
  dependencias?: unknown[];

  @IsString() @IsNotEmpty() @MaxLength(10000)
  interpretacao: string;

  @IsOptional() @IsBoolean()
  exige_revisao_profissional?: boolean;

  @IsOptional() @IsDateString()
  vigencia_inicio?: string;

  @IsOptional() @IsDateString()
  vigencia_fim?: string;
}
