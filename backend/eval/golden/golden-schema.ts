// Formato do banco de perguntas golden (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §3).
// Módulo puro: sem I/O, sem NestJS.
import { normalizeForQuote } from './quote';

export const TIPOS = [
  'conceitual',
  'aplicacao',
  'caso_real',
  'contexto_incompleto',
  'pegadinha',
  'jurisdicional',
  'atribuicao_profissional',
  'sem_evidencia',
] as const;
export type Tipo = (typeof TIPOS)[number];

export const COMPORTAMENTOS = [
  'responder',
  'pedir_contexto',
  'recusar_sem_evidencia',
  'alertar_jurisdicao',
  'alertar_habilitacao',
] as const;
export type Comportamento = (typeof COMPORTAMENTOS)[number];

// Mesmos valores de NoticeType (backend/src/normative/question-notices.ts).
export const AVISOS = ['jurisdicao', 'profissional_habilitado', 'contexto'] as const;
export type AvisoTipo = (typeof AVISOS)[number];

export const RISCOS = ['baixo', 'medio', 'alto'] as const;
export type Risco = (typeof RISCOS)[number];

// A jurisdição A QUE A PERGUNTA SE REFERE — não a das fontes disponíveis
// (hoje só há fonte federal; é justamente o que as perguntas jurisdicionais
// expõem).
export const JURISDICOES = ['federal', 'estadual', 'municipal'] as const;
export type Jurisdicao = (typeof JURISDICOES)[number];

export const STATUS = ['rascunho', 'validado'] as const;
export type Status = (typeof STATUS)[number];

export interface FonteEsperada {
  // 'checklist' fica reservado para a segunda leva do dataset (spec §3.7) e
  // é rejeitado por enquanto.
  fonte: 'norma';
  source_code: string;
  item: string;
  // Trecho LITERAL do PDF vigente; começa pelo número do item.
  evidencia: string;
}

export interface GoldenQuestion {
  id: string;
  tipo: Tipo;
  categoria: string;
  subcategoria: string;
  pergunta: string;
  resposta_esperada: string;
  comportamento_esperado: Comportamento;
  fontes_esperadas: FonteEsperada[];
  avisos_esperados: AvisoTipo[];
  proibido_regex?: string[];
  jurisdicao: Jurisdicao;
  risco_resposta: Risco;
  // Preenchidos por `eval:lint --write` (hash do documento vigente e data).
  versao_fonte: string | null;
  data_verificacao: string | null;
  status: Status;
  gerado_por: string;
  validado_por: string | null;
  validado_em: string | null;
}

// Chaves conhecidas, tipadas com Record<keyof …, true>: acrescentar um campo à
// interface sem listá-lo aqui (ou o contrário) é erro de compilação. Serve para
// rejeitar campo desconhecido: um typo como `proibido_regx` desligaria em
// silêncio a guarda das pegadinhas (`proibido_regex` é o único campo opcional).
const GOLDEN_QUESTION_KEYS: Record<keyof GoldenQuestion, true> = {
  id: true,
  tipo: true,
  categoria: true,
  subcategoria: true,
  pergunta: true,
  resposta_esperada: true,
  comportamento_esperado: true,
  fontes_esperadas: true,
  avisos_esperados: true,
  proibido_regex: true,
  jurisdicao: true,
  risco_resposta: true,
  versao_fonte: true,
  data_verificacao: true,
  status: true,
  gerado_por: true,
  validado_por: true,
  validado_em: true,
};

const FONTE_ESPERADA_KEYS: Record<keyof FonteEsperada, true> = {
  fonte: true,
  source_code: true,
  item: true,
  evidencia: true,
};

// hasOwnProperty (e não `in`): chaves herdadas de Object, como `toString`,
// não podem passar por campo conhecido.
function isKnownKey(known: Record<string, true>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(known, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

// Devolve a lista de problemas do registro; lista vazia = válido.
export function validateGoldenQuestion(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ['registro não é um objeto'];
  }
  const q = raw as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(q)) {
    if (!isKnownKey(GOLDEN_QUESTION_KEYS, key)) errors.push(`campo desconhecido: ${key}`);
  }

  for (const field of ['id', 'categoria', 'subcategoria', 'pergunta', 'resposta_esperada', 'gerado_por']) {
    if (!isNonEmptyString(q[field])) errors.push(`${field}: texto obrigatório`);
  }
  if (isNonEmptyString(q.id) && !/^[A-Z0-9]+-\d{3}$/.test(q.id)) {
    errors.push('id: formato esperado como NR35-001');
  }

  if (!isOneOf(TIPOS, q.tipo)) errors.push(`tipo: valor inválido (${TIPOS.join(' | ')})`);
  if (!isOneOf(COMPORTAMENTOS, q.comportamento_esperado)) {
    errors.push(`comportamento_esperado: valor inválido (${COMPORTAMENTOS.join(' | ')})`);
  }
  if (!isOneOf(RISCOS, q.risco_resposta)) errors.push(`risco_resposta: valor inválido (${RISCOS.join(' | ')})`);
  if (!isOneOf(JURISDICOES, q.jurisdicao)) errors.push(`jurisdicao: valor inválido (${JURISDICOES.join(' | ')})`);
  if (!isOneOf(STATUS, q.status)) errors.push(`status: valor inválido (${STATUS.join(' | ')})`);

  let fontesCount = 0;
  if (!Array.isArray(q.fontes_esperadas)) {
    errors.push('fontes_esperadas: deve ser uma lista');
  } else {
    fontesCount = q.fontes_esperadas.length;
    q.fontes_esperadas.forEach((fonte, index) => {
      const where = `fontes_esperadas[${index}]`;
      if (typeof fonte !== 'object' || fonte === null) {
        errors.push(`${where}: deve ser um objeto`);
        return;
      }
      const f = fonte as Record<string, unknown>;
      for (const key of Object.keys(f)) {
        if (!isKnownKey(FONTE_ESPERADA_KEYS, key)) errors.push(`${where}: campo desconhecido: ${key}`);
      }
      if (f.fonte !== 'norma') {
        errors.push(`${where}.fonte: só 'norma' é suportada (checklist fica para a segunda leva)`);
      }
      for (const field of ['source_code', 'item', 'evidencia']) {
        if (!isNonEmptyString(f[field])) errors.push(`${where}.${field}: texto obrigatório`);
      }
      if (
        isNonEmptyString(f.item) &&
        isNonEmptyString(f.evidencia) &&
        !normalizeForQuote(f.evidencia).startsWith(`${f.item} `)
      ) {
        errors.push(`${where}.evidencia: deve começar pelo número do item ("${f.item} …")`);
      }
    });
  }

  let avisos: string[] = [];
  if (!Array.isArray(q.avisos_esperados)) {
    errors.push('avisos_esperados: deve ser uma lista');
  } else {
    avisos = q.avisos_esperados as string[];
    for (const aviso of avisos) {
      if (!isOneOf(AVISOS, aviso)) errors.push(`avisos_esperados: "${String(aviso)}" inválido (${AVISOS.join(' | ')})`);
    }
  }

  const comportamento = q.comportamento_esperado;
  if (comportamento === 'responder' && fontesCount === 0) {
    errors.push('comportamento responder exige pelo menos 1 fonte esperada');
  }
  if (comportamento === 'recusar_sem_evidencia' && fontesCount > 0) {
    errors.push('comportamento recusar_sem_evidencia exige fontes_esperadas vazio');
  }
  if (comportamento === 'pedir_contexto' && !avisos.includes('contexto')) {
    errors.push("comportamento pedir_contexto exige o aviso 'contexto'");
  }
  if (comportamento === 'alertar_jurisdicao' && !avisos.includes('jurisdicao')) {
    errors.push("comportamento alertar_jurisdicao exige o aviso 'jurisdicao'");
  }
  if (comportamento === 'alertar_habilitacao' && !avisos.includes('profissional_habilitado')) {
    errors.push("comportamento alertar_habilitacao exige o aviso 'profissional_habilitado'");
  }

  if (q.proibido_regex !== undefined) {
    if (!Array.isArray(q.proibido_regex)) {
      errors.push('proibido_regex: deve ser uma lista');
    } else {
      q.proibido_regex.forEach((pattern: unknown, index: number) => {
        if (!isNonEmptyString(pattern)) {
          // Cobre entrada que não é texto (5, null…) e texto vazio ou só espaços.
          errors.push(`proibido_regex[${index}]: deve ser texto`);
          return;
        }
        let compiled: RegExp;
        try {
          compiled = new RegExp(pattern, 'i');
        } catch {
          errors.push(`proibido_regex: "${pattern}" não compila`);
          return;
        }
        // Padrão que casa a string vazia casaria com TODA resposta e reprovaria
        // a pergunta sempre (ex.: ".*").
        if (compiled.test('')) {
          errors.push(`proibido_regex: "${pattern}" casa a string vazia (casaria com qualquer resposta)`);
        }
      });
    }
  }

  if (q.versao_fonte !== null && !isNonEmptyString(q.versao_fonte)) {
    errors.push('versao_fonte: texto ou null');
  }
  if (q.data_verificacao !== null && !(typeof q.data_verificacao === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.data_verificacao))) {
    errors.push('data_verificacao: YYYY-MM-DD ou null');
  }

  if (q.status === 'validado') {
    if (!isNonEmptyString(q.validado_por) || !isNonEmptyString(q.validado_em)) {
      errors.push('status validado exige validado_por e validado_em');
    }
  } else if (q.status === 'rascunho') {
    if (q.validado_por !== null || q.validado_em !== null) {
      errors.push('status rascunho exige validado_por e validado_em nulos');
    }
  }

  return errors;
}

export function validateGoldenDataset(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['o dataset deve ser um array'];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const id = isNonEmptyString((item as { id?: unknown } | null)?.id) ? (item as { id: string }).id : `#${index}`;
    for (const error of validateGoldenQuestion(item)) errors.push(`${id}: ${error}`);
    if (seen.has(id)) errors.push(`${id}: id duplicado`);
    seen.add(id);
  });
  return errors;
}

export function parseGoldenDataset(raw: unknown): GoldenQuestion[] {
  const errors = validateGoldenDataset(raw);
  if (errors.length > 0) {
    throw new Error(`Dataset golden inválido:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return raw as GoldenQuestion[];
}

export function countByTipo(questions: GoldenQuestion[]): Record<Tipo, number> {
  const counts = Object.fromEntries(TIPOS.map((tipo) => [tipo, 0])) as Record<Tipo, number>;
  for (const q of questions) counts[q.tipo] += 1;
  return counts;
}
