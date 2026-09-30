// Verificador v2 (Etapa 1 da Confiabilidade do Assistente, spec
// docs/specs/assistente-confiabilidade-etapa-1.md §4). Módulo puro: sem I/O.
//
// O id-check de NormativeAssistantService só prova que o id citado existe;
// aqui checamos se o que a claim afirma sobre ITEM (35.4.4) e NR (NR-12)
// aparece de fato no texto das fontes que ela mesma cita. Item e NR são
// strings exatas — falha = a claim é descartada. Número com unidade ("8
// horas", "R$ 1.500") tem formas equivalentes ("oito horas") que ainda não
// dá para medir sem dataset, então só é registrado, nunca bloqueia.
export interface ClaimSupportResult {
  // Itens/NRs citados na claim sem base nas evidências — bloqueiam a claim.
  blocking: string[];
  // Números com unidade sem base nas evidências — só registrados.
  logged: string[];
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Família de unidade -> formas de escrita aceitas (já normalizadas).
const UNIT_FAMILIES: Record<string, string[]> = {
  percent: ['%', 'por cento'],
  real: ['reais', 'real'],
  hora: ['horas', 'hora', 'h'],
  dia: ['dias', 'dia'],
  minuto: ['minutos', 'minuto', 'min'],
  mes: ['meses', 'mes'],
  ano: ['anos', 'ano'],
  semana: ['semanas', 'semana'],
  metro: ['metros', 'metro', 'm'],
  cm: ['cm'],
  mm: ['mm'],
  kg: ['kg'],
  db: ['db'],
  grau: ['graus', 'grau', '°c'],
};

const SURFACE_TO_FAMILY = new Map<string, string>();
for (const [family, forms] of Object.entries(UNIT_FAMILIES)) {
  for (const form of forms) SURFACE_TO_FAMILY.set(form, family);
}
// Mais longas primeiro, para "horas" ganhar de "h" e "meses" de "mes".
const UNIT_ALTERNATION = Array.from(SURFACE_TO_FAMILY.keys())
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const UNIT_RIGHT_AFTER_NUMBER = new RegExp(`^\\s*(?:${UNIT_ALTERNATION})(?![a-z])`);

// Token pontuado (35.4.4, 12.10, 2.000). Não pode começar no meio de outro
// número nem continuar em ".dígito" — assim "12.09.2025" (data) não vira o
// falso item "12.09".
const DOTTED_TOKEN = /(?<![\d.,])\d{1,2}(?:\.\d{1,3})+(?!\d|\.\d)/g;
const ITEM_KEYWORD_BEFORE = /\b(?:sub)?ite(?:m|ns)\b[^\d]{0,12}$/;
const THOUSANDS_GROUPING = /^\d{1,3}(?:\.\d{3})+$/;

function extractItemRefs(claim: string): string[] {
  const items = new Set<string>();
  for (const match of claim.matchAll(DOTTED_TOKEN)) {
    const token = match[0];
    const start = match.index as number;
    const before = claim.slice(Math.max(0, start - 24), start);
    const after = claim.slice(start + token.length);

    // A palavra "item" logo antes prevalece sobre qualquer outra regra.
    const afterKeyword = ITEM_KEYWORD_BEFORE.test(before);
    if (afterKeyword) {
      items.add(token);
      continue;
    }
    if (THOUSANDS_GROUPING.test(token)) continue;

    const segments = token.split('.');
    if (segments.length >= 3) {
      items.add(token);
    } else if (segments[1].length <= 2 && !UNIT_RIGHT_AFTER_NUMBER.test(after)) {
      items.add(token);
    }
  }
  return Array.from(items);
}

const NR_REF = /\bnr[-\s]?(\d{1,2})\b/g;

function extractNrNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(NR_REF)) numbers.add(parseInt(match[1], 10));
  return numbers;
}

// Aceita o item exato ou um descendente (35.4 é apoiado por 35.4.4), e
// rejeita prefixo de outro número (5.4 não casa em 35.4; 35.4.4 não casa em
// 35.4.44).
function evidenceHasItem(evidence: string, item: string): boolean {
  return new RegExp(`(?<![\\d.])${escapeRegExp(item)}(?!\\d)`).test(evidence);
}

const NUMBER_WITH_UNIT = new RegExp(
  `(?<![\\d.,])(\\d+(?:[.,]\\d+)*)\\s*(${UNIT_ALTERNATION})(?![a-z])`,
  'g',
);
const REAL_PREFIX = /r\$\s*(\d[\d.,]*\d|\d)/g;

interface NumberWithUnit {
  label: string;
  number: string;
  family: string;
}

function extractNumbersWithUnit(claim: string): NumberWithUnit[] {
  const found: NumberWithUnit[] = [];
  for (const match of claim.matchAll(NUMBER_WITH_UNIT)) {
    found.push({
      label: `${match[1]} ${match[2]}`,
      number: match[1],
      family: SURFACE_TO_FAMILY.get(match[2]) as string,
    });
  }
  for (const match of claim.matchAll(REAL_PREFIX)) {
    found.push({ label: `R$ ${match[1]}`, number: match[1], family: 'real' });
  }
  return found;
}

// Só o mesmo número, aceitando "," ou "." como separador decimal/milhar.
function numberPattern(number: string): string {
  return escapeRegExp(number).replace(/\\[.]|,/g, '[.,]');
}

// Achado da auditoria do Assistente (2026-09-28, item 008): converte um
// inteiro (0-999) pro cardinal por extenso em português, nas formas de
// gênero que aparecem em texto de NR ("um ano", "uma vez", "dois dias",
// "duas horas"). Escrito sem acento de propósito — o texto de evidência já
// chega normalizado (NFD + remoção de marca, ver normalize() acima), então
// "quatorze"/"dezessete" aqui precisam bater com a forma já sem acento.
// Escopo deliberadamente pequeno (0-999): cobre qualquer prazo/quantidade
// plausível de norma de SST ("8 horas", "24 horas", "30 dias", "2 anos");
// números maiores, decimais ou por extenso fora do padrão cardinal simples
// (ordinais, frações) continuam fora — ficam em `logged`, não em
// `blocking`, então nunca bloqueiam uma claim por um falso negativo daqui.
const UNITS: readonly string[] = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS: readonly string[] = [
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
];
const TENS: readonly string[] = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS: readonly string[] = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
];

function twoDigitWords(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const rest = n % 10;
  return rest === 0 ? TENS[tens] : `${TENS[tens]} e ${UNITS[rest]}`;
}

function numberToPortugueseWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 999) return [];
  let masculine: string;
  if (n === 0) masculine = 'zero';
  else if (n === 100) masculine = 'cem';
  else if (n < 100) masculine = twoDigitWords(n);
  else {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    masculine = rest === 0 ? HUNDREDS[hundreds] : `${HUNDREDS[hundreds]} e ${twoDigitWords(rest)}`;
  }
  // Só o último componente do número carrega gênero em português
  // ("vinte e um" / "vinte e uma", nunca "vinte e um" fica "vinte e umo").
  const variants = new Set([masculine]);
  if (masculine.endsWith('um')) variants.add(`${masculine.slice(0, -'um'.length)}uma`);
  if (masculine.endsWith('dois')) variants.add(`${masculine.slice(0, -'dois'.length)}duas`);
  return [...variants];
}

// O mesmo número imediatamente seguido (tolerando espaços e um parêntese
// curto, "8 (oito) horas") de uma unidade da mesma família, OU o número por
// extenso (item 008) seguido da mesma unidade ("oito horas"). Só tenta a
// forma por extenso quando o número da claim é um inteiro simples — decimal
// ("3,5") e número fora de 0-999 continuam sem conversão, e vão pro log
// (nunca bloqueiam), que é exatamente o resíduo que a Etapa 3 mede.
function evidenceHasNumberWithUnit(evidence: string, item: NumberWithUnit): boolean {
  const num = numberPattern(item.number);
  const forms = UNIT_FAMILIES[item.family].map(escapeRegExp).join('|');
  const suffixed = new RegExp(`(?<![\\d.,])${num}\\s*(?:\\([^)]{0,25}\\)\\s*)?(?:${forms})(?![a-z])`);
  if (suffixed.test(evidence)) return true;
  if (item.family === 'real') {
    return new RegExp(`r\\$\\s*${num}(?!\\d)`).test(evidence);
  }
  if (/^\d+$/.test(item.number)) {
    const words = numberToPortugueseWords(parseInt(item.number, 10));
    if (words.length > 0) {
      const wordAlternation = words.map(escapeRegExp).join('|');
      const spelledOut = new RegExp(`\\b(?:${wordAlternation})\\s+(?:${forms})\\b`);
      if (spelledOut.test(evidence)) return true;
    }
  }
  return false;
}

// Fase A — Etapa 2: detector de fonte nominal na claim. Se a claim cita
// uma agência normativa (MTE, Fundacentro, TST, MPT/SmartLab) por nome,
// exigimos que a evidência cubra essa fonte (palavras-chave
// correspondentes no texto citado). Caso contrário, a claim é bloqueada
// por "source_authority" para evitar frases tipo "segundo o MTE" sem
// lastro na evidência.
const AGENCY_PATTERNS: Array<{ agency: string; evidence_keywords: string[] }> = [
  { agency: 'MTE', evidence_keywords: ['mte', 'ministerio do trabalho', 'ministerio do trabalho e emprego'] },
  { agency: 'Fundacentro', evidence_keywords: ['fundacentro', 'fundacao jorge duprat'] },
  { agency: 'TST', evidence_keywords: ['tst', 'tribunal superior do trabalho'] },
  { agency: 'MPT', evidence_keywords: ['mpt', 'ministerio publico do trabalho'] },
];

function claimCitesAgency(claim: string): string | null {
  for (const { agency, evidence_keywords } of AGENCY_PATTERNS) {
    const agencyRegex = new RegExp(`\\b${agency.replace(/\+/g, '\\+')}\\b`, 'i');
    if (agencyRegex.test(claim)) {
      return agency;
    }
  }
  return null;
}

function evidenceCoversAgency(evidence: string, agency: string): boolean {
  const entry = AGENCY_PATTERNS.find((a) => a.agency === agency);
  if (!entry) return false;
  return entry.evidence_keywords.some((kw) => evidence.includes(kw));
}

export function checkClaimSupport(claimText: string, evidenceTexts: string[]): ClaimSupportResult {
  // Sem texto de evidência (ex.: a claim só cita uma imagem anexada) não há
  // o que verificar — mesmo comportamento de "claim sem item/NR": passa.
  if (evidenceTexts.length === 0) return { blocking: [], logged: [] };

  const claim = normalize(claimText);
  const evidence = normalize(evidenceTexts.join('\n'));

  const blocking: string[] = [];

  const evidenceNrs = extractNrNumbers(evidence);
  for (const nr of extractNrNumbers(claim)) {
    if (!evidenceNrs.has(nr)) blocking.push(`NR-${nr}`);
  }
  for (const item of extractItemRefs(claim)) {
    if (!evidenceHasItem(evidence, item)) blocking.push(`item ${item}`);
  }

  // Fase A — Etapa 2: bloqueio por autoridade de fonte. "Segundo o MTE…"
  // sem evidência citando MTE não passa — protege contra confiança
  // auto-declarada.
  const agency = claimCitesAgency(claim);
  if (agency && !evidenceCoversAgency(evidence, agency)) {
    blocking.push(`fonte_nominal_${agency}_sem_evidencia`);
  }

  const logged: string[] = [];
  for (const candidate of extractNumbersWithUnit(claim)) {
    if (!evidenceHasNumberWithUnit(evidence, candidate) && !logged.includes(candidate.label)) {
      logged.push(candidate.label);
    }
  }

  return { blocking, logged };
}
