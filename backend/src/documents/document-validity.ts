// Função PURA: dado o que o cliente mandou + a regra da categoria, decide
// o que vai pro banco (valid_from, expires_at, expires_source,
// validity_months_applied). Sem efeito colateral, sem new Date(), sem I/O.
//
// Regras (contrato de API):
//   a) valid_from, se enviado, tem de ser 'AAAA-MM-DD' válido; senão erro.
//   b) valid_from enviado e expires_at ausente:
//      - regra com meses → expires_at = addMonths(valid_from, meses),
//        expires_source = 'rule', validity_months_applied = meses.
//      - regra NULL → valid_from preservado, expires_at NULL, expires_source
//        NULL, validity_months_applied NULL.
//   c) expires_at enviado:
//      - tem de ser 'AAAA-MM-DD' válido; senão erro.
//      - se valid_from também veio e expires_at < valid_from → erro.
//      - se valid_from veio E a regra tem meses E expires_at é exatamente
//        o calculado → 'rule' + meses. Senão → 'manual' + meses NULL.
//      - sem valid_from → 'manual' + meses NULL.
//   d) nenhum dos dois → tudo null.
//   e) ano da data (input ou resultado de cálculo) tem de estar em
//      1900..2200; fora disso → erro. Evita 500 quando uma data absurda
//      estoura o tipo DATE do Postgres ou a aritmética interna.
//
// `resolveValidity` é usado no POST /documents (a regra decide o que guardar
// a partir do que o cliente enviou). Para o PATCH /documents/:id/validity,
// onde campo AUSENTE significa "manter o atual", existe
// `mergeValidityPatch` abaixo — ambos compartilham `validateDates`.

import { BadRequestException } from '@nestjs/common';
import { addMonths, isDateOnly, type DateOnly } from '../common/dates/date-only';

export type ExpiresSource = 'manual' | 'rule';

export interface ValidityInput {
  validFrom?: string | null;
  expiresAt?: string | null;
  ruleMonths?: number | null;
}

export interface ValidityResolution {
  validFrom: string | null;
  expiresAt: string | null;
  expiresSource: ExpiresSource | null;
  validityMonthsApplied: number | null;
}

// Entrada do PATCH: tudo que a regra precisa pra preservar/limpar/recalcular.
// `current*` é o estado da linha no banco ANTES do PATCH; `validFrom` e
// `expiresAt` são o que o cliente mandou nesta chamada (undefined = não
// enviado = manter; null = enviado como null = limpar; string = valor novo).
export interface ValidityMergeInput {
  validFrom?: string | null;
  expiresAt?: string | null;
  currentValidFrom: string | null;
  currentExpiresAt: string | null;
  currentExpiresSource: ExpiresSource | null;
  currentValidityMonthsApplied: number | null;
  ruleMonths: number | null;
}

// Intervalo aceito de ano. Coberto todo o uso real de SST (1900..2200) e
// longe o suficiente para que addMonths(600) sobre um valid_from dentro do
// intervalo jamais produza algo fora — exceto entradas absurdas tipo
// 9950-01-01, que virariam 500 no Postgres. Por isso o check vale tanto
// para input quanto para o resultado de addMonthsChecked abaixo.
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

function isYearInRange(dateOnly: string): boolean {
  const y = Number(dateOnly.slice(0, 4));
  return y >= MIN_YEAR && y <= MAX_YEAR;
}

function normalize(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  return s;
}

function isRuleMonths(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 600;
}

// Wrapper sobre addMonths que ainda garante que o resultado está dentro do
// intervalo de ano aceito. Sem isso, um valid_from em 2150-01-01 com
// 600 meses produziria 2201-01-01 → DATE overflow no Postgres → 500.
function addMonthsChecked(dateOnly: DateOnly, months: number): DateOnly {
  const result = addMonths(dateOnly, months);
  if (!isYearInRange(result)) {
    throw new Error('data calculada fora do intervalo aceito');
  }
  return result;
}

// Validação compartilhada entre POST e PATCH — usada tanto por
// resolveValidity quanto por mergeValidityPatch. Mensagens em português para
// irem direto no BadRequestException.
function validateDates(validFrom: string | null, expiresAt: string | null): void {
  if (validFrom !== null && !isDateOnly(validFrom)) {
    throw new Error('valid_from inválido: use AAAA-MM-DD');
  }
  if (expiresAt !== null && !isDateOnly(expiresAt)) {
    throw new Error('expires_at inválido: use AAAA-MM-DD');
  }
  if (validFrom !== null && isDateOnly(validFrom) && !isYearInRange(validFrom)) {
    throw new Error('data fora do intervalo aceito');
  }
  if (expiresAt !== null && isDateOnly(expiresAt) && !isYearInRange(expiresAt)) {
    throw new Error('data fora do intervalo aceito');
  }
  if (validFrom && expiresAt && (expiresAt as DateOnly) < (validFrom as DateOnly)) {
    throw new Error('expires_at anterior a valid_from');
  }
}

export function resolveValidity(input: ValidityInput): ValidityResolution {
  const validFromRaw = normalize(input.validFrom);
  const expiresAtRaw = normalize(input.expiresAt);

  validateDates(validFromRaw, expiresAtRaw);

  // d) nada informado → tudo null.
  if (validFromRaw === null && expiresAtRaw === null) {
    return { validFrom: null, expiresAt: null, expiresSource: null, validityMonthsApplied: null };
  }

  const ruleMonths = isRuleMonths(input.ruleMonths) ? input.ruleMonths : null;

  // c) só expires_at → manual, meses null.
  if (validFromRaw === null) {
    return {
      validFrom: null,
      expiresAt: expiresAtRaw,
      expiresSource: 'manual',
      validityMonthsApplied: null,
    };
  }

  // validFrom presente, expiresAt ausente.
  if (expiresAtRaw === null) {
    if (ruleMonths !== null) {
      return {
        validFrom: validFromRaw,
        expiresAt: addMonthsChecked(validFromRaw as DateOnly, ruleMonths),
        expiresSource: 'rule',
        validityMonthsApplied: ruleMonths,
      };
    }
    // b) regra sem meses → sem vencimento automático, mas guarda a data de início.
    return { validFrom: validFromRaw, expiresAt: null, expiresSource: null, validityMonthsApplied: null };
  }

  // validFrom E expiresAt: confere se o enviado é exatamente o cálculo da regra.
  if (ruleMonths !== null) {
    const calculated = addMonthsChecked(validFromRaw as DateOnly, ruleMonths);
    if (calculated === expiresAtRaw) {
      return {
        validFrom: validFromRaw,
        expiresAt: expiresAtRaw,
        expiresSource: 'rule',
        validityMonthsApplied: ruleMonths,
      };
    }
  }
  return {
    validFrom: validFromRaw,
    expiresAt: expiresAtRaw,
    expiresSource: 'manual',
    validityMonthsApplied: null,
  };
}

// Mescla o que o cliente mandou no PATCH com o estado atual do documento,
// respeitando a semântica de "manter/limpar/recalcular" do briefing:
//   - chave AUSENTE (undefined) = manter o valor atual
//   - chave explícita null = limpar (zera)
//   - expires_at AUSENTE: recalcula pela regra SOMENTE se valid_from mudou
//     nesta chamada (não-undefined) e a regra tem meses; senão mantém o
//     atual. Regra sem meses + valid_from novo = preserva expires_at
//     (NUNCA zera um vencimento só porque a categoria não tem regra).
//   - expires_at valor: confere se bate com a regra; se sim → 'rule', se
//     não → 'manual'.
//   - valida expires_at >= valid_from no estado final.
//
// Lança Error com mensagem em português; o service converte em
// BadRequestException (NÃO deixa virar 500).
export function mergeValidityPatch(input: ValidityMergeInput): ValidityResolution {
  // Validação de formato ANTES de qualquer cálculo — sem isso, addMonths
  // receberia uma string não-AAAA-MM-DD e a mensagem do erro seria
  // "addMonths: data inválida" sem citar o campo, quebrando o teste.
  if (input.validFrom !== null && input.validFrom !== undefined && !isDateOnly(input.validFrom)) {
    throw new Error('valid_from inválido: use AAAA-MM-DD');
  }
  if (input.expiresAt !== null && input.expiresAt !== undefined && !isDateOnly(input.expiresAt)) {
    throw new Error('expires_at inválido: use AAAA-MM-DD');
  }
  // Checagem de intervalo de ano para inputs não-undefined — não usamos
  // validateDates aqui porque ele rejeita null (queremos que null
  // signifique "limpar", não "data fora do intervalo").
  if (input.validFrom !== null && input.validFrom !== undefined && !isYearInRange(input.validFrom)) {
    throw new Error('data fora do intervalo aceito');
  }
  if (input.expiresAt !== null && input.expiresAt !== undefined && !isYearInRange(input.expiresAt)) {
    throw new Error('data fora do intervalo aceito');
  }

  // 1) valid_from
  let finalValidFrom: string | null;
  if (input.validFrom === undefined) {
    finalValidFrom = input.currentValidFrom;
  } else {
    // null explícito → limpa; string → usa o valor novo
    finalValidFrom = input.validFrom;
  }

  // 2) expires_at
  let finalExpiresAt: string | null;
  let finalExpiresSource: ExpiresSource | null;
  let finalMonths: number | null;
  const ruleMonths = input.ruleMonths;

  if (input.expiresAt === undefined) {
    // Recalcular pela regra SOMENTE se valid_from mudou nesta chamada E
    // temos uma regra com meses E o novo valid_from não é null.
    if (input.validFrom !== undefined && input.validFrom !== null && isRuleMonths(ruleMonths)) {
      finalExpiresAt = addMonthsChecked(finalValidFrom as DateOnly, ruleMonths);
      finalExpiresSource = 'rule';
      finalMonths = ruleMonths;
    } else {
      // Preserva o atual (incluindo quando valid_from veio null ou regra
      // sem meses — caso explícito do briefing "nunca zerar").
      finalExpiresAt = input.currentExpiresAt;
      finalExpiresSource = input.currentExpiresSource;
      finalMonths = input.currentValidityMonthsApplied;
    }
  } else if (input.expiresAt === null) {
    finalExpiresAt = null;
    finalExpiresSource = null;
    finalMonths = null;
  } else {
    // expires_at explícito (string) — sempre grava o valor.
    finalExpiresAt = input.expiresAt;
    // Identifica se o novo par (newValidFrom, expiresAt) bate com a regra.
    if (isRuleMonths(ruleMonths) && finalValidFrom !== null) {
      const calculated = addMonthsChecked(finalValidFrom as DateOnly, ruleMonths);
      if (calculated === input.expiresAt) {
        finalExpiresSource = 'rule';
        finalMonths = ruleMonths;
      } else {
        finalExpiresSource = 'manual';
        finalMonths = null;
      }
    } else {
      finalExpiresSource = 'manual';
      finalMonths = null;
    }
  }

  validateDates(finalValidFrom, finalExpiresAt);

  return {
    validFrom: finalValidFrom,
    expiresAt: finalExpiresAt,
    expiresSource: finalExpiresSource,
    validityMonthsApplied: finalMonths,
  };
}

// Helper para o service converter o Error da função pura em 400 sem ter que
// saber o texto exato da mensagem em cada ponto.
export function toBadRequest(err: unknown): BadRequestException {
  if (err instanceof BadRequestException) return err;
  if (err instanceof Error) {
    return new BadRequestException(err.message);
  }
  return new BadRequestException('Dados de vigência inválidos');
}
