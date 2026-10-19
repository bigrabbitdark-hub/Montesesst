import { isHealthText, LocalPerson } from './employee-text-extractor';
import { SheetField } from './employee-sheet.parser';
import { AiPerson } from './employee-extraction-provider.interface';

// Minimização de PII antes da IA (AGENTS.md "IA") e verificação do que a IA devolve. Puro, sem rede.
// A IA é tratada como NÃO confiável: o texto do documento é dado (pode conter injeção de prompt) e a resposta só vale
// onde é comprovável no trecho citado, que por sua vez precisa existir no texto que realmente enviamos.

export interface AiBatch { text: string; refs: Map<string, string> } // refs: "CPF_1" -> cpf de 11 dígitos (NUNCA enviado)

const RADIUS = 400;
// Teto de lotes por documento (o serviço decide quantos chama; o construtor nunca passa disso).
export const MAX_AI_BATCHES = 8;
export const DEFAULT_AI_MAX_PEOPLE = 12;
const MAX_PEOPLE_CAP = 25;
// Na verificação aceita-se um trecho maior (a IA costuma incluir mais de uma linha); o que é exibido vem do extrator local.
const MAX_EVIDENCE = 400;
const MAX_EVIDENCE_OUT = 200;
const MAX_VALUE = 200;
const MAX_TOKENS = 6000;
const CLOSING = /respons[a]vel|assinatura|observa|rodape|certifico|atenciosamente/;
const HEADER = /cnpj|razao social/;
const SEPARATOR = '\n[trecho omitido]\n'; // com letras: não encadeia dígitos de trechos diferentes
// Corrida "paranoica" de dígitos, independente de formato: 9+ dígitos com até 8 não alfanuméricos entre eles.
// Uma letra solta entre dígitos ("1x1x4x...") também conta como separador.
const SEP = '(?:[^\\p{L}\\p{N}]|\\p{L}(?=[^\\p{L}\\p{N}]?\\d))';
const NUM_RUN = new RegExp(`\\d(?:${SEP}{0,8}\\d){8,}`, 'gu');

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Normalização de comparação (evidence/valores): sem acentos, minúsculas, espaços colapsados.
export const normalizeForCompare = (s: string): string => stripAccents(s).replace(/\s+/g, ' ').trim().toLowerCase();
const lineKey = (line: string) => stripAccents(line.normalize('NFKC')).toLowerCase();
const isClosing = (line: string) => CLOSING.test(lineKey(line));
const isHeader = (line: string) => HEADER.test(lineKey(line));

// Tudo que pode quebrar/esconder uma sequência numérica sai: marcas combinantes (CGJ, seletores de variação), caracteres
// de formato (zero-width, tags), controle e a faixa usada pelos marcadores internos; dígitos de qualquer escrita viram
// ASCII; espaços colapsam (assim "\n    " entre dígitos vira um separador só).
function normalizeText(raw: string): string {
  let t = raw.replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n').normalize('NFKC');
  t = t.replace(/[\p{M}\p{Cf}\uAC00-\uD7A3]/gu, '').replace(/[^\P{Cc}\n]/gu, ' ');
  t = t.replace(/\p{Nd}/gu, (ch) => {
    if (/[0-9]/.test(ch)) return ch;
    let start = ch.codePointAt(0)!;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((ch.codePointAt(0)! - start) % 10);
  });
  return t.split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
}

const LABEL_MAT = /(?<![A-Za-zÀ-ÿ])(matr[ií]cula(?:[ ]+e-?social)?|matr\.?|mat\.?|(?:n[º°o]\.?[ ]?)?registro|reg\.?|ctps|c\.b\.o\.?|cbo|pis|pasep|nit|rg)(?![A-Za-zÀ-ÿ])/gi;

// Fragmentos numéricos (3+ dígitos, com os separadores adjacentes) colados a uma borda que NÃO é início/fim do documento:
// o que está do outro lado da borda foi omitido e poderia ser o resto de um número (CPF de terceiro quebrado em linhas).
// Uma data completa na borda é preservada (não completa um CPF). Também serve de asserção (retorno != entrada).
function stripBorderDigits(t: string, edges: { start: boolean; end: boolean }): string {
  const isDate = (frag: string) => /^[^\p{L}\p{N}]*(?:(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))[^\p{L}\p{N}]*$/u.test(frag);
  if (edges.start) {
    const m = new RegExp(`^(?:${SEP}{0,8}\\d){3,}[^\\p{L}\\p{N}]{0,8}`, 'u').exec(t);
    if (m && !isDate(m[0])) t = t.slice(m[0].length);
  }
  if (edges.end) {
    const tailAt = Math.max(0, t.length - 120);
    const tail = t.slice(tailAt);
    const m = new RegExp(`(?:${SEP}{0,8}\\d){3,}[^\\p{L}\\p{N}]{0,8}$`, 'u').exec(tail);
    if (m && !isDate(m[0])) t = t.slice(0, tailAt) + tail.slice(0, m.index);
  }
  return t;
}

function sanitizeWindow(raw: string, cpfToRef: Map<string, string>, counters: { mat: number; cbo: number }, edges: { start: boolean; end: boolean }): string {
  const tokens: string[] = [];
  const tok = (s: string): string => {
    if (tokens.length >= MAX_TOKENS) throw new Error('tokens');
    tokens.push(s);
    return String.fromCharCode(0xac00 + tokens.length - 1); // letras: marcadores não encadeiam dígitos
  };
  let t = normalizeText(raw);
  t = t.split('\n').filter((l) => !isHeader(l)).join('\n');
  // Marcadores literais do documento não podem se passar pelos nossos.
  t = t.replace(/\[(?=\s*(?:CPF|MAT|CBO|NUM)(?![A-Za-z]))/gi, '(');
  // CPFs das pessoas do lote, em qualquer formatação → [CPF_n].
  const seq = /\d(?:[^\p{L}\p{N}]{0,8}\d){10}/uy;
  let out = '';
  for (let i = 0; i < t.length; ) {
    const ch = t[i];
    if (ch >= '0' && ch <= '9' && (i === 0 || !(t[i - 1] >= '0' && t[i - 1] <= '9'))) {
      seq.lastIndex = i;
      const m = seq.exec(t);
      const ref = m ? cpfToRef.get(m[0].replace(/\D/g, '')) : undefined;
      if (m && ref && !/\d/.test(t[i + m[0].length] ?? '')) {
        out += tok(`[${ref}]`);
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  t = out;
  // Matrícula/registro/CBO e outros documentos rotulados (valor some; só o marcador fica).
  t = t.replace(
    new RegExp(`${LABEL_MAT.source}([ ]*[:\\-–]?[ ]*\\n?[ ]*)(\\d(?:[ .\\-/]{0,8}\\d){0,30})`, 'gi'),
    (_m, label: string, sep: string) => {
      const l = label.toLowerCase();
      const marker = /^(cbo|c\.b\.o)/.test(l) ? `[CBO_${++counters.cbo}]` : /^(pis|pasep|nit|rg)$/.test(l) ? '[NUM removido]' : `[MAT_${++counters.mat}]`;
      return `${label}${sep}${tok(marker)}`;
    },
  );
  // Varredura paranoica: 9+ dígitos (datas isoladas têm 8) viram [NUM removido], contando os dígitos de datas também.
  t = t.replace(NUM_RUN, () => tok('[NUM removido]'));
  t = stripBorderDigits(t, edges);
  return t.replace(/[\uAC00-\uD7A3]/g, (c) => tokens[c.charCodeAt(0) - 0xac00] ?? '');
}

// Defesa em profundidade, sobre o trecho já com marcadores (trocados por letra): nenhuma corrida de 9+ dígitos, nenhum
// padrão 3-3-3 e nenhum fragmento numérico em borda de omissão. "[trecho omitido]" é separador numérico TRANSPARENTE.
export function hasCpfShape(piece: string, edges = { start: false, end: false }): boolean {
  const t = piece
    .replace(/\[(?:CPF|MAT|CBO)_\d+\]|\[(?:CPF|NUM) removido\]/g, 'X')
    .replace(/\s*\[trecho omitido\]\s*/g, '\n');
  return (
    new RegExp(`\\d(?:${SEP}{0,8}\\d){8,}`, 'u').test(t) ||
    /\d{3}[^\p{L}\p{N}]{0,8}\d{3}[^\p{L}\p{N}]{0,8}\d{3}/u.test(t) ||
    stripBorderDigits(t, edges) !== t
  );
}

interface Win { lo: number; hi: number; person: LocalPerson }

// Janela formada por LINHAS INTEIRAS (nunca corta no meio de uma linha, o que deixaria um CPF de terceiro pela metade).
// Só linha de CPF maior que a janela é cortada, e em espaço.
function windowFor(text: string, p: LocalPerson, lineStarts: number[]): Win | null {
  const m = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/y;
  m.lastIndex = p.start;
  const hit = m.exec(text);
  if (!hit || hit[0].replace(/\D/g, '') !== p.cpf) return null;
  const end = p.start + hit[0].length;
  let a = 0;
  let b = lineStarts.length - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (lineStarts[mid] <= p.start) a = mid; else b = mid - 1;
  }
  const li = a;
  const lineEnd = (i: number) => (i + 1 < lineStarts.length ? lineStarts[i + 1] - 1 : text.length);
  const ls = lineStarts[li];
  const le = lineEnd(li);
  const sample = text.slice(Math.max(ls, p.start - RADIUS), Math.min(le, end + RADIUS));
  if (isClosing(sample) || isHeader(sample)) return null;
  if (le - ls > 2 * RADIUS + 40) {
    let lo = Math.max(ls, p.start - RADIUS);
    let hi = Math.min(le, end + RADIUS);
    if (lo > ls) { const k = text.slice(lo, p.start).search(/\s/); lo = k < 0 ? p.start : lo + k; }
    if (hi < le) { const k = text.slice(end, hi).search(/\s\S*$/); hi = k < 0 ? end : end + k; }
    return { lo, hi, person: p };
  }
  let first = li;
  while (first > 0 && p.start - lineStarts[first - 1] <= RADIUS && !isClosing(text.slice(lineStarts[first - 1], lineEnd(first - 1)))) first--;
  let last = li;
  while (last + 1 < lineStarts.length && lineEnd(last + 1) - end <= RADIUS && !isClosing(text.slice(lineStarts[last + 1], lineEnd(last + 1)))) last++;
  return { lo: lineStarts[first], hi: lineEnd(last), person: p };
}

function mergedLength(wins: Win[]): number {
  const sorted = [...wins].sort((a, b) => a.lo - b.lo);
  let total = 0;
  let curHi = -1;
  let curLo = 0;
  for (const w of sorted) {
    if (curHi >= 0 && w.lo <= curHi + 1) curHi = Math.max(curHi, w.hi);
    else { if (curHi >= 0) total += curHi - curLo + SEPARATOR.length; curLo = w.lo; curHi = w.hi; }
  }
  if (curHi >= 0) total += curHi - curLo;
  return total;
}

function buildBatch(text: string, wins: Win[], maxChars: number): AiBatch | null {
  const sorted = [...wins].sort((a, b) => a.lo - b.lo);
  const refs = new Map<string, string>();
  const cpfToRef = new Map<string, string>();
  sorted.forEach((w, i) => { refs.set(`CPF_${i + 1}`, w.person.cpf); cpfToRef.set(w.person.cpf, `CPF_${i + 1}`); });
  const merged: { lo: number; hi: number }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.lo <= last.hi + 1) last.hi = Math.max(last.hi, w.hi);
    else merged.push({ lo: w.lo, hi: w.hi });
  }
  const counters = { mat: 0, cbo: 0 };
  let pieces: { t: string; edges: { start: boolean; end: boolean } }[];
  try {
    pieces = merged
      .map((m) => {
        const edges = { start: m.lo > 0, end: m.hi < text.length };
        return { t: sanitizeWindow(text.slice(m.lo, m.hi), cpfToRef, counters, edges), edges };
      })
      .filter((x) => x.t.trim() !== '');
  } catch {
    return null;
  }
  if (pieces.some((x) => hasCpfShape(x.t, x.edges))) return null; // não envia: descarta o lote inteiro
  const body = pieces.map((x) => x.t).join(SEPARATOR);
  if (hasCpfShape(body) || body.length > maxChars) return null; // o corpo inteiro: separador de peças é transparente
  // Os marcadores só valem se de fato chegaram ao texto; refs sem marcador no texto são removidas.
  for (const key of [...refs.keys()]) if (!body.includes(`[${key}]`)) refs.delete(key);
  if (refs.size === 0) return null;
  return { text: body, refs };
}

export function buildAiBatches(text: string, people: LocalPerson[], opts?: { maxChars?: number; maxPeople?: number }): AiBatch[] {
  const maxChars = opts?.maxChars ?? 8000;
  const maxPeople = Math.max(1, Math.min(opts?.maxPeople ?? DEFAULT_AI_MAX_PEOPLE, MAX_PEOPLE_CAP));
  // Folga: marcadores/[NUM removido] podem ser um pouco maiores que o que substituem.
  const budget = Math.floor(maxChars * 0.7);
  if (!text || people.length === 0) return [];
  if (isHealthText(text)) return []; // defesa em profundidade: o chamador já filtra
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const wins = people
    .map((p) => windowFor(text, p, lineStarts))
    .filter((w): w is Win => w !== null)
    .sort((a, b) => a.person.start - b.person.start);
  const groups: Win[][] = [];
  let cur: Win[] = [];
  for (const w of wins) {
    if (mergedLength([w]) > budget) continue; // janela isolada maior que o teto: omite a pessoa
    if (cur.length > 0 && (cur.length >= maxPeople || mergedLength([...cur, w]) > budget)) {
      groups.push(cur);
      cur = [];
      if (groups.length >= MAX_AI_BATCHES) break;
    }
    cur.push(w);
  }
  if (cur.length > 0 && groups.length < MAX_AI_BATCHES) groups.push(cur);
  const batches: AiBatch[] = [];
  for (const g of groups) {
    const b = buildBatch(text, g, maxChars);
    if (b) batches.push(b);
  }
  return batches;
}

// ---------- Vale a pena chamar a IA? ----------
// Só quando a IA pode acrescentar algo: falta nome, cargo ou admissão; ou falta nascimento/sexo e a janela tem o rótulo.
export function needsAi(person: LocalPerson, windowText: string): boolean {
  const v = person.values ?? {};
  if (!v.full_name || !v.position || !v.admission_date) return true;
  const w = normalizeForCompare(windowText ?? '');
  if (!v.birth_date && /nasc/.test(w)) return true;
  if (!v.sex && /sexo|genero/.test(w)) return true;
  return false;
}

// ---------- Verificação ----------
const REF_RE = /^CPF_\d{1,3}$/;
const AI_FIELDS = ['full_name', 'birth_date', 'sex', 'position', 'admission_date'] as const;
type AiField = (typeof AI_FIELDS)[number];
const MAX_RAW_ITEMS = 500;
// Rótulos de formulário: nunca valem como nome ou cargo.
const LABEL_WORDS = new Set([
  'nome', 'cpf', 'funcao', 'cargo', 'cbo', 'matricula', 'sexo', 'genero', 'admissao', 'nascimento', 'data', 'setor', 'atividade',
  'descricao', 'funcionario', 'colaborador', 'registro', 'esocial', 'de', 'do', 'da',
]);
const OTHER_LABEL_WORD = /nome|cargo|funcao|sexo|admiss|nasc|cpf|setor|data|adm\b|dn\b/;

export type DiscardReason = 'cpf_ref' | 'evidence' | 'campo' | 'duplicado' | 'limite';
export interface VerifiedPerson { cpf: string; values: Partial<Record<SheetField, string>>; evidence: string }
export interface VerifyStats {
  items_total: number;
  items_verified: number;
  fields_verified: number;
  discarded: Record<DiscardReason, number>;
}

// Normalização com mapa de volta ao índice do texto original (para devolver a FATIA literal do evidence).
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) { pendingSpace = norm.length > 0; continue; }
    const n = stripAccents(c).toLowerCase();
    if (pendingSpace) { norm += ' '; map.push(i); pendingSpace = false; }
    for (const ch of n) { norm += ch; map.push(i); }
  }
  return { norm, map };
}

const isAlnum = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);

// Posição de `needle` em `hay` com fronteira de palavra nos dois lados.
function findWord(hay: string, needle: string): number {
  if (!needle) return -1;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!isAlnum(hay[i - 1]) && !isAlnum(hay[i + needle.length])) return i;
  }
  return -1;
}

// Primeira ocorrência (com fronteira de palavra) cujo dono NÃO é um terceiro.
function findWordOwned(hay: string, needle: string, ctx: OwnerCtx): number {
  if (!needle) return -1;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!isAlnum(hay[i - 1]) && !isAlnum(hay[i + needle.length]) && !ownedByThirdParty(ctx, i)) return i;
  }
  return -1;
}

const wordsOf = (s: string) => s.split(' ').filter(Boolean);
const isLabelOnly = (vn: string) => wordsOf(vn).every((w) => LABEL_WORDS.has(w));
const hasLabelWord = (vn: string) => wordsOf(vn).some((w) => LABEL_WORDS.has(w) && w !== 'de' && w !== 'do' && w !== 'da');

// ---------- Dono do valor (anti-parente/terceiro) ----------
// Um rótulo de parente/terceiro ("Mãe:", "Dependente", "Nasc. do filho", "Responsável:") ABRE um bloco: todo valor depois
// dele, até um novo marcador [CPF_n], linha em branco ou [trecho omitido], pertence ao terceiro, mesmo sob um "Nome:"
// genérico. Ambíguo => recusa (perde recall, mas o controle real continua sendo a revisão humana).
// Palavras fortes: contam em qualquer posição; fracas (também são cargos) só quando formam um RÓTULO ("Engenheiro:").
// O dono é calculado sobre o texto do LOTE ao redor da ocorrência do trecho (não só sobre o que a IA devolve): um rótulo de
// parente antes do trecho, no mesmo registro (sem linha em branco, [trecho omitido] ou outro [CPF_n] no meio), vale.
const STRONG_OPENER = new RegExp(
  '(?<![a-z])(' +
    [
      'maes?', 'pais?', 'conjuge', 'esposa', 'esposo', 'marido', 'companheir[oa]', 'dependentes?', 'filhos?', 'filhas?',
      'irmaos?', 'irmas?', 'responsavel', 'testemunhas?', 'avalista', 'filiacao', 'genitor(?:a|es)?', 'pensionista',
      'beneficiari[oa]', 'netos?', 'netas?', 'sobrinh[oa]s?', 'entead[oa]s?', 'sogr[oa]s?', 'cunhad[oa]s?', 'tutor(?:a)?',
      'curador(?:a)?', 'spouse', 'wife', 'husband', 'son', 'daughter', 'mother', 'father', 'parents?', 'child(?:ren)?',
      'resp\\.?', 'conj\\.?', 'dep(?!\\.? ?(?:pessoal|financeiro|rh|juridico|comercial|de |do |da ))\\.?',
    ].join('|') +
    ')(?![a-z])',
  'g',
);
const WEAK_OPENER = /(?<![a-z])(medico|medica|engenheir[oa]|tecnico|tecnica|contato|emergencia|representante|supervisor(?:a)?|gestor(?:a)?|chefe|encarregad[oa]|lider)(?![a-z])([a-z0-9 ./()-]{0,25}):/g;
// Texto do documento tentando falar com a IA: o trecho inteiro é descartado.
const INJECTION = /ignor[ae]\b|desconsidere|esqueca|retorne|responda com|prompt|ignore (?:all|previous)|you are/;

interface OwnerCtx { occ: { base: number; openers: { pos: number; header: boolean }[] }[]; closers: number[]; headerClosers: number[] }
const HEADER_LABEL = /nome|cpf|nasc|cargo|funcao|admiss|sexo|setor|matric/;
function ownerContext(evidence: string, ev: { norm: string; map: number[] }, batch: { text: string; bn: { norm: string; map: number[] } }): OwnerCtx {
  const bn = batch.bn;
  // Ocorrências do trecho no lote (se não achar, cai para o próprio trecho, como antes).
  const bases: number[] = [];
  for (let i = bn.norm.indexOf(ev.norm); i >= 0 && bases.length < 5; i = bn.norm.indexOf(ev.norm, i + 1)) bases.push(i);
  const useBatch = bases.length > 0;
  const hay = useBatch ? bn.norm : ev.norm;
  const map = useBatch ? bn.map : ev.map;
  const orig = useBatch ? batch.text : evidence;
  if (!useBatch) bases.push(0);
  const lineOfPos = (p: number) => {
    const o = map[Math.min(p, map.length - 1)] ?? 0;
    const s = orig.lastIndexOf('\n', o - 1) + 1;
    const e = orig.indexOf('\n', o);
    return orig.slice(s, e < 0 ? orig.length : e);
  };
  const isHeaderLine = (line: string) => {
    if (!/[|;\t]| {3,}/.test(line)) return false;
    const k = normalizeForCompare(line);
    return (k.match(new RegExp(HEADER_LABEL, 'g')) ?? []).length >= 2;
  };
  const all: { pos: number; header: boolean }[] = [];
  for (const m of hay.matchAll(STRONG_OPENER)) all.push({ pos: m.index!, header: isHeaderLine(lineOfPos(m.index!)) });
  for (const m of hay.matchAll(WEAK_OPENER)) if (!OTHER_LABEL_WORD.test(m[2])) all.push({ pos: m.index!, header: isHeaderLine(lineOfPos(m.index!)) });
  const closers: number[] = [];
  const headerClosers: number[] = [];
  const both = (p: number) => { closers.push(p); headerClosers.push(p); };
  // Qualquer marcador [CPF_n] (o próprio ou de outra pessoa) encerra o bloco de um rótulo comum; rótulo de CABEÇALHO de tabela
  // ("Nome | CPF | Dependente") não é encerrado por marcador: vale para as linhas seguintes até linha em branco/omitido.
  for (const m of hay.matchAll(/\[cpf_\d+\]/g)) closers.push(m.index!);
  for (let i = hay.indexOf('[trecho omitido]'); i >= 0; i = hay.indexOf('[trecho omitido]', i + 1)) both(i);
  for (const m of orig.matchAll(/\n[ \t\r]*\n/g)) {
    const k = map.findIndex((o) => o >= m.index!);
    if (k >= 0) both(k);
  }
  return {
    occ: bases.map((base) => ({ base, openers: all.filter((o) => o.pos >= Math.max(0, base - 600) && o.pos < base + ev.norm.length) })),
    closers,
    headerClosers,
  };
}
// O valor em `idx` (índice normalizado do TRECHO) pertence a um terceiro? (em qualquer ocorrência do trecho no lote)
function ownedByThirdParty(ctx: OwnerCtx, idx: number): boolean {
  return ctx.occ.some(({ base, openers }) => {
    const at = base + idx;
    return openers.some((o) => o.pos < at && !(o.header ? ctx.headerClosers : ctx.closers).some((c) => c > o.pos && c < at));
  });
}

const DATE_RE = '(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})|(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})';
const DATE_LABELS: Record<'birth_date' | 'admission_date', string> = {
  birth_date: 'nascid[oa] em|nasc[a-z.]*|(?<![a-z])dn',
  admission_date: 'admitid[oa] em|admiss[a-z.]*|(?<![a-z])adm\\.?',
};
const parseDate = (v: string): [number, number, number] | null => {
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v);
  let d: number, mo: number, y: number;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(v))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? [d, mo, y] : null;
};
const pad2 = (n: number) => String(n).padStart(2, '0');

// Devolve o valor como está ESCRITO no evidence (fatia do original), ou null.
function verifyField(field: AiField, rawValue: string, evidence: string, ev: { norm: string; map: number[] }, ctx: OwnerCtx): string | null {
  const value = rawValue.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
  if (!value || /[\[\]]/.test(value)) return null;
  const vn = normalizeForCompare(value);
  const slice = (idx: number, len: number) => evidence.slice(ev.map[idx], ev.map[idx + len - 1] + 1).trim();
  switch (field) {
    case 'full_name': {
      if (/\d/.test(vn) || wordsOf(vn).length < 2 || wordsOf(vn).length > 8 || hasLabelWord(vn)) return null;
      if (vn === ev.norm && wordsOf(vn).length > 8) return null; // nome = trecho inteiro: provável injeção/lixo
      const i = findWordOwned(ev.norm, vn, ctx);
      return i < 0 ? null : slice(i, vn.length);
    }
    case 'birth_date':
    case 'admission_date': {
      // Compara por COMPONENTES (dia, mês, ano de 4 dígitos); o rótulo do campo precisa estar no próprio evidence.
      const want = parseDate(value);
      if (!want) return null;
      const re = new RegExp(`(?:${DATE_LABELS[field]})[^0-9a-z]{0,8}(?:${DATE_RE})`, 'g');
      for (const m of ev.norm.matchAll(re)) {
        const got: [number, number, number] = m[1] ? [+m[1], +m[2], +m[3]] : [+m[6], +m[5], +m[4]];
        if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) continue;
        if (ownedByThirdParty(ctx, m.index! + m[0].length)) continue;
        return `${pad2(want[0])}/${pad2(want[1])}/${want[2]}`;
      }
      return null;
    }
    case 'sex': {
      const letter = /^(f|feminino)$/.test(vn) ? 'F' : /^(m|masculino)$/.test(vn) ? 'M' : null;
      if (!letter) return null;
      const alt = letter === 'F' ? 'f|feminino' : 'm|masculino';
      for (const m of ev.norm.matchAll(new RegExp(`(?:sexo|genero)[^0-9a-z]{0,4}(?:${alt})(?![a-z0-9])`, 'g'))) {
        if (!ownedByThirdParty(ctx, m.index! + m[0].length)) return letter;
      }
      return null;
    }
    case 'position': {
      if (vn.length < 2 || !/[a-z]/.test(vn) || isLabelOnly(vn)) return null;
      const i = findWordOwned(ev.norm, vn, ctx);
      return i < 0 ? null : slice(i, vn.length);
    }
  }
}

const maskMarkers = (evidence: string, refs: Map<string, string>): string =>
  evidence.replace(/\[(CPF_\d{1,3})\]/g, (m, key: string) => {
    const cpf = refs.get(key);
    return cpf ? `***.***.***-${cpf.slice(-2)}` : m;
  });

// "[CPF_2]", "cpf_2", " CPF_2 " → "CPF_2".
const normalizeRef = (ref: unknown): string | null =>
  typeof ref === 'string' && ref.length <= 24 ? ref.replace(/[\[\]\s]/g, '').toUpperCase() : null;

export function verifyAiPeopleWithStats(
  batch: AiBatch,
  ai: AiPerson[],
  opts?: { maxPeople?: number },
): { people: VerifiedPerson[]; stats: VerifyStats } {
  const stats: VerifyStats = {
    items_total: 0, items_verified: 0, fields_verified: 0,
    discarded: { cpf_ref: 0, evidence: 0, campo: 0, duplicado: 0, limite: 0 },
  };
  const people: VerifiedPerson[] = [];
  if (!Array.isArray(ai)) return { people, stats };
  stats.items_total = ai.length;
  const batchNorm = normalizeForCompare(batch.text);
  const bn = normalizeWithMap(batch.text);
  const maxPeople = Math.max(1, opts?.maxPeople ?? batch.refs.size);
  const taken = new Set<string>();
  for (const it of ai.slice(0, MAX_RAW_ITEMS)) {
    if (typeof it !== 'object' || it === null || Array.isArray(it)) { stats.discarded.cpf_ref++; continue; }
    const rec = it as unknown as Record<string, unknown>;
    const ref = normalizeRef(rec.cpf_ref);
    if (!ref || !REF_RE.test(ref) || !batch.refs.has(ref)) { stats.discarded.cpf_ref++; continue; }
    if (taken.has(ref)) { stats.discarded.duplicado++; continue; } // mantém o PRIMEIRO válido
    const evidence = rec.evidence;
    if (typeof evidence !== 'string' || evidence.length > MAX_EVIDENCE) { stats.discarded.evidence++; continue; }
    const ev = normalizeWithMap(evidence);
    // O trecho precisa estar no texto enviado e ser DESTA pessoa: contém o marcador próprio e nenhum de outra.
    const own = new RegExp(`\\[${ref}\\]`, 'i');
    const markers = [...evidence.matchAll(/\[\s*CPF_(\d{1,3})\s*\]/gi)].map((m) => `CPF_${m[1]}`);
    if (
      ev.norm.length < 3 || !batchNorm.includes(ev.norm) || !own.test(evidence) ||
      markers.some((m) => m !== ref) || /\*{3}\.\*{3}\.\*{3}-\d{2}/.test(evidence)
    ) { stats.discarded.evidence++; continue; }
    if (INJECTION.test(ev.norm)) { stats.discarded.evidence++; continue; }
    const values: Partial<Record<SheetField, string>> = {};
    const ctx = ownerContext(evidence, ev, { text: batch.text, bn });
    for (const field of AI_FIELDS) {
      const raw = rec[field];
      if (typeof raw !== 'string') continue;
      const v = verifyField(field, raw, evidence, ev, ctx);
      if (v) values[field] = v;
    }
    const n = Object.keys(values).length;
    if (n === 0) { stats.discarded.campo++; continue; }
    if (people.length >= maxPeople) { stats.discarded.limite++; continue; }
    taken.add(ref);
    people.push({
      cpf: batch.refs.get(ref)!,
      values,
      evidence: maskMarkers(evidence.replace(/\s+/g, ' ').trim().replace(/\[\s*(CPF_\d{1,3})\s*\]/gi, (_m, k: string) => `[${k.toUpperCase()}]`), batch.refs).slice(0, MAX_EVIDENCE_OUT),
    });
    stats.items_verified++;
    stats.fields_verified += n;
  }
  return { people, stats };
}

export function verifyAiPeople(batch: AiBatch, ai: AiPerson[], opts?: { maxPeople?: number }): VerifiedPerson[] {
  return verifyAiPeopleWithStats(batch, ai, opts).people;
}


// ---------- Texto da PRÓPRIA pessoa (para needsAi) ----------
let lineCache: { text: string; starts: number[] } | null = null;
function lineStartsOf(text: string): number[] {
  if (lineCache && lineCache.text === text) return lineCache.starts;
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  lineCache = { text, starts };
  return starts;
}
const NAME_LINE = /^(nome|funcionario|colaborador|empregado)(?![a-z])/;
const MAX_OWN_LINES = 12;

// Só o texto da pessoa: da linha do CPF dela (mais, no máximo, 2 linhas antes SE uma delas começa com rótulo de nome e
// nenhuma contém CPF de outra) até a linha anterior à âncora da PRÓXIMA pessoa (âncora = linha de nome logo acima do
// CPF dela, se houver); no máximo 12 linhas. Nada de texto de vizinho.
export function personWindowText(text: string, person: LocalPerson, allPeople: LocalPerson[]): string {
  if (!text) return '';
  const starts = lineStartsOf(text);
  const lineOf = (pos: number) => {
    let a = 0;
    let b = starts.length - 1;
    while (a < b) { const mid = (a + b + 1) >> 1; if (starts[mid] <= pos) a = mid; else b = mid - 1; }
    return a;
  };
  const lineText = (i: number) => text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] - 1 : text.length);
  const keyOf = (i: number) => stripAccents(lineText(i).normalize('NFKC')).trim().toLowerCase();
  const personLines = new Set(allPeople.filter((p) => p !== person).map((p) => lineOf(p.start)));
  const li = lineOf(person.start);
  let first = li;
  for (let k = 1; k <= 2 && li - k >= 0; k++) {
    if (personLines.has(li - k)) break;
    const key = keyOf(li - k);
    if (NAME_LINE.test(key)) { first = li - k; break; }
    // linha intermediária com nasc/sexo pode ser da pessoa ANTERIOR (layout CPF-primeiro): não arrisca
    if (/nasc|sexo|genero/.test(key)) break;
  }
  const next = allPeople.filter((p) => p.start > person.start).sort((a, b) => a.start - b.start)[0];
  let lastExclusive = Math.min(starts.length, first + MAX_OWN_LINES);
  if (next) {
    const nl = lineOf(next.start);
    const anchor = nl - 1 > li && NAME_LINE.test(keyOf(nl - 1)) ? nl - 1 : nl;
    if (anchor > li) lastExclusive = Math.min(lastExclusive, anchor);
    else lastExclusive = li + 1; // outra pessoa na MESMA linha: só a linha
  }
  lastExclusive = Math.max(lastExclusive, li + 1);
  const out: string[] = [];
  for (let i = first; i < lastExclusive && out.length < MAX_OWN_LINES; i++) out.push(lineText(i));
  return out.join('\n');
}
