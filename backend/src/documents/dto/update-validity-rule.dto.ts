// Body do PATCH /api/documents/validity-rules/:category (admin).
// validity_months é o que vai calcular o vencimento; null = sem vencimento
// automático. alert_days é a antecedência do alerta (0..365). Os dois são
// opcionais no DTO — o service aplica a regra "manter o valor atual"
// quando a chave AUSENTE (undefined) e grava o valor quando vier explícito.
//
// Diferença importante entre os dois:
//   - validity_months: aceita null explícito (significa "sem regra");
//     ValidateIf(o, v !== null && v !== undefined) deixa a chave AUSENTE
//     passar sem validar (mantém o valor atual) e null explícito passar
//     também (vai gravar NULL).
//   - alert_days: NÃO aceita null (a coluna é NOT NULL). Usamos
//     ValidateIf(o, v !== undefined) para que null passe pelos
//     validadores e seja rejeitado por @IsInt com 400 em português
//     em vez de virar 500 no service tentando gravar NULL.
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

export class UpdateValidityRuleDto {
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(600)
  validity_months?: number | null;

  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(365)
  alert_days?: number;
}
