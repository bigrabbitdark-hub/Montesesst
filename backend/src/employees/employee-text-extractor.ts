import { isValidCpf, onlyDigits } from './employee-fields.util';
import { SheetField } from './employee-sheet.parser';

// Extrator local (sem IA, sem banco) para texto livre de PDF/DOCX. Puro: só regex com janelas limitadas.
// Regras de ouro: (1) nunca preencher campo sem rótulo/forma reconhecível; (2) dado de uma pessoa NUNCA vai
// para outra: na dúvida o campo é OMITIDO (falha fechada); (3) nenhuma busca ilimitada em linha gigante.

export type CadastralVerdict =
  | { eligible: true; cpfCount: number }
  | { eligible: false; reason: 'saude' | 'sem_cpf' | 'sem_rotulos' };

export interface LocalPerson {
  cpf: string; // 11 dígitos
  values: Partial<Record<SheetField, string>>; // sem o cpf
  evidence: string; // ≤ 200 chars, CPF mascarado
  start: number; // posição do CPF no texto
}

// ---------- Detector de saúde ----------
// Os padrões valem para o texto NORMALIZADO por `normalizeForHealth` (sem acentos, minúsculas, espaços
// colapsados). Erram de propósito para o lado de NÃO LER: falso positivo recusa o documento (seguro).
export const HEALTH_MARKERS: RegExp[] = [
  /\baso\b/, /\ba[.\-]s[.\-]o\b/, /\ba s o\b/, /\batestado\b/, /saude ocupacional/, /\bpcmso\b/, /exames? medicos?/,
  /exame (clinico|complementar|admissional|demissional|periodico|toxicologico)/, /audio[- ]?metr/, /esp ?iro[- ]?metr/,
  /hemograma/, /eletrocardiograma/, /acuidade visual/, /restricao medica/, /\bapt[oa]s?\b/, /\binapt/, /aptidao/,
  /\bcid\b/, /cid-?10/, /classificacao internacional de doencas/, /\bcrm\b/, /medico (do trabalho|examinador|coordenador)/,
  /parecer medico/, /medicina do trabalho/, /\bafastamento/, /\binss\b/,
];

export const normalizeForHealth = (text: string): string =>
  text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

export const isHealthText = (text: string): boolean => {
  const n = normalizeForHealth(text);
  return HEALTH_MARKERS.some((r) => r.test(n));
};

// ---------- CPF ----------
// Fronteiras: sem letra/dígito/_/-// colados nos dois lados e sem "1.5299..."/"...25,3" (número decimal/maior).
const CPF_RE = /(?<![A-Za-z0-9_\-\/=#&?À-ÿ])(?<!\d[.,])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![A-Za-z0-9_\-\/=#&?À-ÿ])(?![.,]\d)/g;
// Rótulos de OUTROS documentos/números: o valor que os segue não é CPF (a menos que "cpf" apareça na linha).
const NOT_CPF_LABEL = /(?<![A-Za-zÀ-ÿ])(pis|pasep|nit|ctps|protocolo|inscri[cç][aã]o|conta|ag[eê]ncia|rg|tel|fone|telefone|celular|cbo|matr[ií]cula|e-?social|documento)(?![A-Za-zÀ-ÿ])/i;
const LABELS = /(nome|funcionario|colaborador|admissao|cargo|funcao|cbo|matricula|nascimento)/i;

const MAX_BACK = 300;
const MAX_FORWARD = 800;

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const maskCpf = (cpf: string) => `***.***.***-${cpf.slice(-2)}`;

// Início/fim da linha de `idx`, com busca limitada (linha de 1 MB sem quebras não pode custar O(n) por CPF).
function lineBounds(text: string, idx: number, back = MAX_BACK, fwd = MAX_FORWARD): { s: number; e: number; cutS: boolean; cutE: boolean } {
  const lo = Math.max(0, idx - back);
  const nl = text.slice(lo, idx).lastIndexOf('\n');
  const hi = Math.min(text.length, idx + fwd);
  const nr = text.slice(idx, hi).indexOf('\n');
  return {
    s: nl >= 0 ? lo + nl + 1 : lo, cutS: nl < 0 && lo > 0,
    e: nr >= 0 ? idx + nr : hi, cutE: nr < 0 && hi < text.length,
  };
}

// Exportado para o serviço decidir `sem_rotulos` sem chamar detectCadastral (que roda extractLocalPeople de novo).
export const hasCadastralLabels = (text: string): boolean => LABELS.test(stripAccents(text));

export function detectCadastral(text: string): CadastralVerdict {
  if (isHealthText(text)) return { eligible: false, reason: 'saude' };
  const people = extractLocalPeople(text);
  if (people.length === 0) return { eligible: false, reason: 'sem_cpf' };
  if (!hasCadastralLabels(text)) return { eligible: false, reason: 'sem_rotulos' };
  return { eligible: true, cpfCount: people.length };
}

// ---------- Rótulos ----------
type Kind = 'full_name' | 'position' | 'birth_date' | 'admission_date' | 'sex' | 'cbo_code' | 'registration_number' | 'cpf';
const DATE = String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})`;
const NB = String.raw`(?<![A-Za-zÀ-ÿ0-9])`;
const SRC: Record<Kind, string> = {
  full_name: String.raw`(?:nome(?:[ \t]+completo)?|funcion[aá]rio|colaborador)(?=[ \t]*[:\-])`,
  position: String.raw`(?:fun[cç][aã]o|cargo)(?:\/cargo)?(?=[ \t]*[:\-])`,
  birth_date: String.raw`(?:data[ \t]+de[ \t]+)?nascimento(?=[ \t]*[:\-]?[ \t]*\d)`,
  admission_date: String.raw`(?:data[ \t]+de[ \t]+)?admiss[aã]o(?=[ \t]*[:\-]?[ \t]*\d)`,
  sex: String.raw`sexo(?:[ \t]*f\/m)?`,
  cbo_code: String.raw`cbo(?![A-Za-zÀ-ÿ])`,
  // "Matrícula" só é rótulo com ':'/'-' ou número logo depois (cargo "Gerente de Matrícula" não se quebra).
  registration_number: String.raw`matr[ií]cula(?:[ \t]+e-?social)?(?=[ \t]*[:\-]|[ \t]+\d)`,
  cpf: String.raw`cpf(?![A-Za-zÀ-ÿ0-9])`,
};
const KINDS = Object.keys(SRC) as Kind[];
const FIELD_KINDS = KINDS.filter((k) => k !== 'cpf');
const LABEL_RE = new RegExp(KINDS.map((k) => `(?<${k}>${NB}${SRC[k]})`).join('|'), 'gi');
const CPF_LIKE = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

const VALUE: Partial<Record<Kind, RegExp>> = {
  full_name: /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. ]*/,
  birth_date: new RegExp(`^${DATE}`), admission_date: new RegExp(`^${DATE}`),
  sex: /^(feminino|masculino|fem|masc|f|m)(?![A-Za-zÀ-ÿ])/i,
  cbo_code: /^(\d{4}(?:[\-.]?\d{2})?)(?!\d)/, registration_number: /^(\d{4,15})(?!\d)/,
};

function cleanValue(kind: Kind, raw: string): string | undefined {
  const v = raw.replace(/^[ \t]*[:\-]?[ \t]*/, '').trim();
  if (!v) return undefined;
  if (kind === 'position') {
    // Rótulo quebrado pelo PDF no fim do cargo ("ALMOXARIFE  Admissão:"): só sai se vier com ":" ou "-" (cargo "Analista de Admissão" fica).
    const p = v.replace(/[ \t]+(?:data[ \t]+de[ \t]+)?(?:admiss[aã]o|nascimento|sexo|cbo|matr[ií]cula(?:[ \t]+e-?social)?|cpf|nome)[ \t]*[:\-][ \t]*$/i, '').replace(/[ \t,;:\-]+$/, '').trim();
    return /[A-Za-zÀ-ÿ]{2}/.test(p) ? p : undefined;
  }
  const m = VALUE[kind]?.exec(v);
  if (!m) return undefined;
  if (kind === 'full_name') { const n = m[0].trim(); return /[A-Za-zÀ-ÿ]{2}/.test(n) ? n : undefined; }
  if (kind === 'sex') return m[1].toLowerCase().startsWith('f') ? 'F' : 'M';
  if (kind === 'cbo_code') return onlyDigits(m[1]);
  return m[1];
}

// Valor de uma célula de tabela: a célula INTEIRA tem de ter a forma do campo (senão omite).
function cellValue(kind: Kind, cell: string): string | undefined {
  const v = cell.trim();
  if (!v || /[;|]/.test(v)) return undefined;
  if (kind === 'position') return cleanValue(kind, v);
  const m = VALUE[kind]?.exec(v);
  if (!m || m[0].trim().length !== v.length) return undefined;
  return cleanValue(kind, v);
}

// ---------- Nome sem rótulo (lista/tabela por linha) ----------
const WORDS = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.]{0,30}(?: [A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.]{0,30}){1,7}$/;
const NAME_TAIL = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.]{0,30}(?: [A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.]{0,30}){1,7}[ \t|;,\-–]*$/;
const NAME_LABEL_LEAD = /^(?:nome(?:[ \t]+completo)?|funcion[aá]rio|colaborador)[ \t]*[:\-][ \t]*/i;
const NAME_ANY = new RegExp(`${NB}${SRC.full_name}`, 'i');

// Linha com 1 CPF: 2+ palavras de letras (espaço simples) imediatamente antes do CPF; recusa se são valor de rótulo.
function plainNameBefore(prefixRaw: string): string | undefined {
  const prefix = prefixRaw.replace(/(?<![A-Za-z])cpf[ \t:.\-]*$/i, '');
  const m = NAME_TAIL.exec(prefix.slice(-200));
  if (!m) return undefined;
  const head = prefix.slice(-200).slice(0, m.index).trimEnd();
  if (head.endsWith(':')) return undefined;
  return m[0].replace(/[ \t|;,\-–]+$/, '');
}

// Nome de um CPF que divide a linha com outros: só delimitador explícito (| ; tab) ou rótulo "Nome:" na linha toda em
// "nome primeiro". Espaço simples entre pessoas NUNCA separa (não dá para saber onde termina o cargo e começa o nome).
function sharedLineName(seg: string, j: number, nameFirstLine: boolean): string | undefined {
  const cleaned = seg.replace(/(?<![A-Za-z])cpf[ \t:.\-]*$/i, '');
  const raw = cleaned.split(/[;|\t]/);
  let li = raw.length - 1;
  while (li >= 0 && raw[li].trim() === '') li--;
  if (li < 0) return undefined;
  let piece = raw[li].trim();
  const lead = NAME_LABEL_LEAD.exec(piece);
  if (lead) {
    if (!nameFirstLine) return undefined;
    piece = piece.slice(lead[0].length).trim();
  } else if (j > 0 && li === 0) {
    return undefined; // 2º CPF em diante sem delimitador antes do segmento
  } else if (j === 0 && li === 0 && raw.length === 1) {
    return plainNameBefore(seg);
  }
  return piece && !piece.includes(':') && WORDS.test(piece) ? piece : undefined;
}

// ---------- Linhas, regiões e encerradores ----------
// Quebras alternativas viram \n SEM mudar o comprimento (posições `start` continuam valendo).
const normalizeBreaks = (t: string) => t.replace(/\r\n/g, ' \n').replace(/[\r\u2028\u2029\u000b\u000c\u0085]/g, '\n');
const BLANK = /^[\s\u200B-\u200D\u2060\uFEFF]*$/;
// Linha que COMEÇA com palavra de encerramento (rodapé, assinatura, carimbo) encerra a leitura: o resto do documento é ignorado.
const CLOSER = /^[ \t|>*#-]*(?:respons[aá]vel|assinatura|elaborad[oa]|aprovad[oa]|visto|carimbo|local e data|engenheir[oa]|m[eé]dic[oa]|t[eé]cnic[oa] respons[aá]vel|data:|local:|observa[cç][aã]o|observa[cç][oõ]es|obs\.?:|notas?|anexos?|rodap[eé]|declara[cç][aã]o|certifico|atenciosamente)(?![A-Za-zÀ-ÿ])/i;

interface Hit { cpf: string; rel: number; len: number }
interface Ln { s: number; t: string; hits: Hit[] }
interface Mark { kind: Kind; s: number; e: number }

// Linhas NÃO vazias (linha em branco não carrega informação: DOCX separa todo parágrafo com uma) com seus CPFs válidos.
const MAX_LINES = 50000; // teto global de trabalho: além disso o resto do documento é ignorado

function buildLines(text: string): Ln[] {
  const out: Ln[] = [];
  let pos = 0;
  while (pos <= text.length && out.length < MAX_LINES) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    const t = text.slice(pos, nl);
    if (!BLANK.test(t)) {
      const hits: Hit[] = [];
      for (const m of t.matchAll(CPF_RE)) {
        const rel = m.index ?? 0;
        if (!isValidCpf(m[0])) continue;
        const pre = t.slice(Math.max(0, rel - 80), rel);
        const lb = pre.trim() === '' && out.length > 0 ? out[out.length - 1].t.slice(-80) : pre;
        if (NOT_CPF_LABEL.test(lb) && !/(?<![A-Za-z])cpf(?![A-Za-z])/i.test(lb)) continue;
        hits.push({ cpf: onlyDigits(m[0]), rel, len: m[0].length });
      }
      out.push({ s: pos, t, hits });
    }
    pos = nl + 1;
  }
  return out;
}

function marksOf(t: string): Mark[] {
  const out: Mark[] = [];
  for (const m of t.matchAll(LABEL_RE)) {
    const kind = KINDS.find((k) => m.groups?.[k] !== undefined);
    if (kind) out.push({ kind, s: m.index ?? 0, e: (m.index ?? 0) + m[0].length });
  }
  return out;
}

// ---------- Leitura de um registro (rótulos) ----------
interface RecordRead { counts: Map<Kind, number>; vals: Map<Kind, string | undefined>; src: Map<Kind, number[]>; pos: Map<Kind, number> }

// Lê os rótulos das linhas [from, to). O valor vem depois de ":"/tab, na mesma linha, ou na linha SEGUINTE quando a do
// rótulo fica sem valor e a seguinte é texto puro; para no próximo rótulo, em ; | tab e no fim da linha; nunca atravessa
// um CPF. Nome/cargo seguidos de linha de texto solto (quebra de linha do PDF) são omitidos.
function readRecord(lines: Ln[], marks: (i: number) => Mark[], from: number, to: number, allowNext: boolean): RecordRead {
  const counts = new Map<Kind, number>();
  const vals = new Map<Kind, string | undefined>();
  const src = new Map<Kind, number[]>();
  const pos = new Map<Kind, number>();
  const plain = (j: number) => j >= from && j < to && lines[j].hits.length === 0 && marks(j).length === 0;
  for (let i = from; i < to; i++) {
    const ms = marks(i);
    ms.forEach((mk, k) => {
      if (mk.kind === 'cpf') return;
      counts.set(mk.kind, (counts.get(mk.kind) ?? 0) + 1);
      const t = lines[i].t;
      const stop = Math.min(k + 1 < ms.length ? ms[k + 1].s : t.length, mk.e + 300);
      let rest = t.slice(mk.e, stop).replace(/^[ \t]*[:\-]?[ \t]*/, '');
      let vLine = i;
      if (rest.trim() === '' && k + 1 === ms.length && allowNext && plain(i + 1)) { rest = lines[i + 1].t.trim(); vLine = i + 1; }
      const cut = rest.search(/[;|\t]/);
      if (cut >= 0) rest = rest.slice(0, cut);
      if (mk.kind === 'full_name' || mk.kind === 'position') {
        const c = rest.search(CPF_LIKE);
        if (c >= 0) rest = rest.slice(0, c);
      }
      let v = cleanValue(mk.kind, rest);
      if (v && (mk.kind === 'full_name' || mk.kind === 'position') && allowNext && plain(vLine + 1) && /^[A-Za-zÀ-ÿ]/.test(lines[vLine + 1].t.trim())) v = undefined;
      vals.set(mk.kind, v);
      src.set(mk.kind, vLine === i ? [i] : [i, vLine]);
      pos.set(mk.kind, (i - from) * 1e7 + mk.s);
    });
  }
  return { counts, vals, src, pos };
}

// ---------- Tabelas por cabeçalho ----------
const COLS: Record<string, Kind | 'skip'> = {
  nome: 'full_name', 'nome completo': 'full_name', funcionario: 'full_name', colaborador: 'full_name',
  cpf: 'cpf', funcao: 'position', cargo: 'position', 'funcao/cargo': 'position', 'cargo/funcao': 'position',
  admissao: 'admission_date', 'data de admissao': 'admission_date', 'data admissao': 'admission_date',
  nascimento: 'birth_date', 'data de nascimento': 'birth_date', 'data nascimento': 'birth_date',
  sexo: 'sex', 'sexo f/m': 'sex', cbo: 'cbo_code', matricula: 'registration_number', 'matricula esocial': 'registration_number',
  'matricula e-social': 'registration_number', qtde: 'skip', item: 'skip', 'descricao da atividade': 'skip',
};
const colKind = (t: string): Kind | 'skip' | undefined => {
  if (t.length > 40) return undefined;
  const k = stripAccents(t).toLowerCase().replace(/\s+/g, ' ').trim();
  return Object.prototype.hasOwnProperty.call(COLS, k) ? COLS[k] : undefined;
};
const validHeader = (kinds: (Kind | 'skip' | undefined)[]): kinds is (Kind | 'skip')[] => {
  if (kinds.length < 2 || kinds.some((k) => k === undefined) || !kinds.includes('cpf')) return false;
  const real = kinds.filter((k) => k !== 'skip');
  return new Set(real).size === real.length;
};

function splitRaw(t: string): string[] {
  if (t.includes('|')) return t.split('|').map((c) => c.trim());
  if (t.includes('\t')) return t.split('\t').map((c) => c.trim());
  if (/\S {2,}\S/.test(t)) return t.trim().split(/ {2,}/);
  return [];
}

// Cabeçalho: sem células vazias, só pipes das bordas descartados.
function headerCells(t: string): string[] {
  const parts = splitRaw(t);
  if (t.includes('|')) {
    if (parts[0] === '') parts.shift();
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  }
  return parts;
}

// Linha de dados com k colunas: células vazias PRESERVADAS (alinhamento); pipes de borda só se sobrarem células.
function rowCells(t: string, k: number): string[] {
  const parts = splitRaw(t);
  if (!t.includes('|')) return parts;
  const tt = t.trim();
  if (parts.length === k + 2 && parts[0] === '' && parts[parts.length - 1] === '') return parts.slice(1, -1);
  if (parts.length === k + 1) {
    if (tt.startsWith('|') && parts[0] === '') return parts.slice(1);
    if (tt.endsWith('|') && parts[parts.length - 1] === '') return parts.slice(0, -1);
  }
  return parts;
}

interface TableHeader { at: number; k: number; kinds: (Kind | 'skip')[]; vertical: boolean }

const MAX_COLS = 12;

function findTableHeader(lines: Ln[], from: number, to: number): TableHeader | undefined {
  // colKind uma única vez por linha (normaliza cada linha uma vez); varredura sempre para frente (O(n)).
  const memo = new Map<number, Kind | 'skip' | undefined>();
  const kindOf = (i: number) => {
    if (!memo.has(i)) memo.set(i, lines[i].hits.length === 0 ? colKind(lines[i].t) : undefined);
    return memo.get(i);
  };
  let i = from;
  while (i < to) {
    const t = lines[i].t;
    if (t.length <= 200 && lines[i].hits.length === 0) {
      const cells = headerCells(t);
      if (cells.length >= 2) {
        if (cells.length <= MAX_COLS) {
          const kinds = cells.map(colKind);
          if (validHeader(kinds)) return { at: i, k: kinds.length, kinds, vertical: false };
        }
        i++;
        continue;
      }
      let j = i;
      while (j < to && j - i <= MAX_COLS && kindOf(j) !== undefined) j++;
      const run = j - i;
      if (run >= 2 && run <= MAX_COLS) {
        const kinds: (Kind | 'skip' | undefined)[] = [];
        for (let q = i; q < j; q++) kinds.push(kindOf(q));
        if (validHeader(kinds)) return { at: i, k: kinds.length, kinds, vertical: true };
      }
      if (run > MAX_COLS) { // sequência longa demais para ser cabeçalho: pula o trecho todo
        while (j < to && kindOf(j) !== undefined) j++;
      }
      i = Math.max(i + 1, j);
      continue;
    }
    i++;
  }
  return undefined;
}

interface TableRow { line: number; hit: Hit; values: Partial<Record<SheetField, string>>; evidenceLines?: string[] }

// Devolve as linhas de pessoas ou null (aborta a tabela INTEIRA: aridade, CPF fora da coluna, célula vazia desalinhando).
function readTable(lines: Ln[], hdr: TableHeader, to: number): { rows: TableRow[]; endLine: number } | null {
  const cpfCol = hdr.kinds.indexOf('cpf');
  const rows: TableRow[] = [];
  const build = (cells: string[], lineOfCpf: number, hitOk: (c: string) => Hit | undefined): TableRow | null => {
    const hit = hitOk(cells[cpfCol]);
    if (!hit) return null;
    const values: Partial<Record<SheetField, string>> = {};
    hdr.kinds.forEach((kind, c) => {
      if (kind === 'cpf' || kind === 'skip') return;
      const v = cellValue(kind, cells[c]);
      if (v) values[kind as SheetField] = v;
    });
    return { line: lineOfCpf, hit, values };
  };
  if (hdr.vertical) {
    const first = hdr.at + hdr.k;
    const groups = Math.floor((to - first) / hdr.k);
    if (groups <= 0) return null;
    const last = first + groups * hdr.k;
    // Linhas FINAIS depois do último grupo completo: toleradas só se não têm CPF nem são nome de coluna.
    for (let q = last; q < to; q++) if (lines[q].hits.length > 0 || colKind(lines[q].t) !== undefined) return null;
    for (let g = first; g < last; g += hdr.k) {
      const grp = lines.slice(g, g + hdr.k);
      const cl = g + cpfCol;
      if (grp.reduce((a, l) => a + l.hits.length, 0) !== 1 || lines[cl].hits.length !== 1) return null;
      const row = build(grp.map((l) => l.t), cl, (c) => {
        const h = lines[cl].hits[0];
        return c.trim() === lines[cl].t.slice(h.rel, h.rel + h.len) ? h : undefined;
      });
      if (!row) return null;
      row.evidenceLines = grp.map((l) => l.t);
      rows.push(row);
    }
    return { rows, endLine: last };
  }
  let i = hdr.at + 1;
  for (; i < to; i++) {
    const t = lines[i].t;
    if (/^[\s|:\-]+$/.test(t)) continue; // separador de Markdown
    const cells = rowCells(t, hdr.k);
    if (splitRaw(t).length < 2) break;
    if (cells.length !== hdr.k || lines[i].hits.length !== 1) return null;
    const row = build(cells, i, (c) => {
      const h = lines[i].hits[0];
      return c.trim() === t.slice(h.rel, h.rel + h.len) ? h : undefined;
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows.length > 0 ? { rows, endLine: i } : null;
}

const maskDigits = (s: string) => s.replace(/\d(?:[ .\-\/]{0,3}\d){10,}/g, (m) => maskCpf(onlyDigits(m)));

// Evidência de linha com um só CPF: trecho ao redor dele, qualquer sequência de 11+ dígitos mascarada.
function singleLineEvidence(t: string, rel: number): string {
  const b = lineBounds(t, rel, 110, 150);
  const a = Math.max(b.s, rel - 110);
  const z = Math.min(b.e, rel + 150);
  let s = maskDigits(t.slice(a, z));
  // Corte no meio de uma sequência numérica deixaria dígitos de CPF: descarta o pedaço numérico da borda cortada.
  if (a > b.s || b.cutS) s = s.replace(/^[\d .\-\/]+(?=\D)/, '');
  if (z < b.e || b.cutE) s = s.replace(/(?<=\D)[\d .\-\/]+$/, '');
  return s.trim().slice(0, 200);
}

// ---------- Extração ----------
export function extractLocalPeople(textIn: string): LocalPerson[] {
  const text = normalizeBreaks(textIn);
  const all = buildLines(text);
  if (!all.some((l) => l.hits.length > 0)) return []; // sem CPF válido não há pessoa: nada mais a fazer
  const cache: (Mark[] | undefined)[] = new Array(all.length);
  const marksAll = (i: number): Mark[] => (cache[i] ??= marksOf(all[i].t));

  // Âncora: o primeiro rótulo de identidade, linha com CPF ou cabeçalho de tabela. Antes dela, tudo é ignorado.
  // Linha que já é de encerramento (ex.: "Responsável: JOSE CPF ...") nunca é âncora: o CPF dela não é de funcionário.
  const isCloser = (i: number) => CLOSER.test(all[i].t.slice(0, 80));
  let first = all.findIndex((l, i) => !isCloser(i) && (l.hits.length > 0 || marksAll(i).some((m) => m.kind === 'full_name' || m.kind === 'cpf')));
  if (first < 0) return [];
  const hdrAny = findTableHeader(all, 0, Math.min(all.length, first + 1));
  if (hdrAny && hdrAny.at < first) first = hdrAny.at;
  // Encerrador após a âncora: dali ao fim do documento nada é lido.
  let end = all.length;
  for (let i = first + 1; i < all.length; i++) if (CLOSER.test(all[i].t.slice(0, 80))) { end = i; break; }
  const region = all.slice(first, end);

  const found: { start: number; person: LocalPerson }[] = [];
  const add = (ln: Ln, hit: Hit, values: Partial<Record<SheetField, string>>, evidence: string) =>
    found.push({ start: ln.s + hit.rel, person: { cpf: hit.cpf, values, evidence, start: ln.s + hit.rel } });

  // 1) Tabela por cabeçalho.
  let rest = region;
  const hdr = findTableHeader(region, 0, region.length);
  if (hdr) {
    const tb = readTable(region, hdr, region.length);
    if (tb) {
      for (const r of tb.rows) {
        const ev = r.evidenceLines ? r.evidenceLines.map((l) => maskDigits(l.trim()).slice(0, 60)).join(' | ').slice(0, 200) : singleLineEvidence(region[r.line].t, r.hit.rel);
        add(region[r.line], r.hit, r.values, ev);
      }
      rest = [...region.slice(0, hdr.at), ...region.slice(tb.endLine)];
    }
  }

  // 2) Registros ancorados em rótulo de identidade (só com regra dos rótulos comuns).
  const restMarks = rest.map((l) => marksOf(l.t));
  const rm = (i: number) => restMarks[i];
  const totalHits = rest.reduce((a, l) => a + l.hits.length, 0);
  let records: { from: number; to: number }[] | null = null;
  if (totalHits > 0) {
    const firstId = rest.findIndex((l, i) => l.hits.length > 0 || restMarks[i].some((m) => m.kind === 'full_name' || m.kind === 'cpf'));
    const anchorMark = firstId >= 0 ? restMarks[firstId].find((m) => m.kind === 'full_name' || m.kind === 'cpf') : undefined;
    if (firstId >= 0 && anchorMark) {
      const anchor = anchorMark.kind;
      const starts: number[] = [];
      let multi = false;
      for (let i = firstId; i < rest.length; i++) {
        const n = restMarks[i].filter((m) => m.kind === anchor).length;
        if (n > 1) multi = true;
        if (n >= 1) starts.push(i);
      }
      // "plain": a primeira linha com CPF vem ANTES de qualquer rótulo de identidade => sem segmentação por rótulo.
      const plainFirst = rest.findIndex((l) => l.hits.length > 0) < firstId;
      if (!multi && !plainFirst && starts.length === totalHits) {
        const recs = starts.map((s0, k) => ({ from: s0, to: k + 1 < starts.length ? starts[k + 1] : rest.length }));
        // Cada registro: exatamente 1 CPF e nenhum rótulo de identidade extra (outro "Nome:"/"CPF:" = texto de outra pessoa).
        const other: Kind = anchor === 'full_name' ? 'cpf' : 'full_name';
        const ok = recs.every((r) => {
          let hits = 0; let extra = 0;
          for (let i = r.from; i < r.to; i++) { hits += rest[i].hits.length; extra += restMarks[i].filter((m) => m.kind === other).length; }
          return hits === 1 && extra <= 1;
        });
        // Todos os registros com o MESMO deslocamento âncora -> linha do CPF (contagem coincidente não basta: G1/G2).
        const offs = recs.map((r0) => { let li = r0.from; while (li < r0.to && rest[li].hits.length === 0) li++; return li - r0.from; });
        if (ok && offs.every((o) => o === offs[0])) records = recs;
      }
    }
  }

  if (records) {
    const reads = records.map((r) => readRecord(rest, rm, r.from, r.to, true));
    let common = FIELD_KINDS.filter((k) => reads.every((rd) => rd.counts.get(k) === 1));
    // Ordem relativa dos rótulos tem de ser a mesma em todos os registros; par inconsistente descarta os dois campos.
    const bad = new Set<Kind>();
    for (const a of common) for (const b of common) {
      if (a >= b) continue;
      const sign = reads.map((rd) => (rd.pos.get(a) as number) < (rd.pos.get(b) as number));
      if (sign.some((x) => x !== sign[0])) { bad.add(a); bad.add(b); }
    }
    common = common.filter((k) => !bad.has(k));
    records.forEach((r, ri) => {
      let li = r.from;
      while (li < r.to && rest[li].hits.length === 0) li++;
      const ln = rest[li]; const hit = ln.hits[0];
      const values: Partial<Record<SheetField, string>> = {};
      for (const k of common) { const v = reads[ri].vals.get(k); if (v) values[k as SheetField] = v; }
      if (!reads[ri].counts.get('full_name')) {
        const name = plainNameBefore(ln.t.slice(0, hit.rel));
        if (name && /[A-Za-zÀ-ÿ]{2}/.test(name)) values.full_name = name;
      }
      // Valores de OUTRAS linhas entram na evidência (rótulo+valor), para o revisor ver de onde vieram.
      const extra: string[] = []; const seenL = new Set<number>([li]);
      for (const k of Object.keys(values) as SheetField[]) {
        for (const j of reads[ri].src.get(k as Kind) ?? []) {
          if (seenL.has(j) || rest[j].hits.length > 0) continue;
          seenL.add(j);
          extra.push(maskDigits(rest[j].t.trim()).slice(0, 70));
        }
      }
      add(ln, hit, values, [singleLineEvidence(ln.t, hit.rel), ...extra].join(' | ').slice(0, 200));
    });
  } else {
    // 3) Mesma linha do CPF (lista, tabela por linha, texto corrido): nada entre linhas.
    rest.forEach((ln, li) => {
      if (ln.hits.length === 1) {
        const hit = ln.hits[0];
        const rd = readRecord(rest, rm, li, li + 1, false);
        const values: Partial<Record<SheetField, string>> = {};
        for (const k of FIELD_KINDS) { const v = rd.vals.get(k); if (v && rd.counts.get(k) === 1) values[k as SheetField] = v; }
        if (!rd.counts.get('full_name')) {
          const name = plainNameBefore(ln.t.slice(0, hit.rel));
          if (name && /[A-Za-zÀ-ÿ]{2}/.test(name)) values.full_name = name;
        }
        add(ln, hit, values, singleLineEvidence(ln.t, hit.rel));
      } else if (ln.hits.length > 1) {
        const segs = ln.hits.map((h, j) => ln.t.slice(j === 0 ? 0 : ln.hits[j - 1].rel + ln.hits[j - 1].len, h.rel));
        const nameFirstLine = segs.every((sg) => NAME_ANY.test(sg));
        ln.hits.forEach((h, j) => {
          const values: Partial<Record<SheetField, string>> = {};
          const name = sharedLineName(segs[j], j, nameFirstLine);
          if (name) values.full_name = name;
          // Evidência de linha compartilhada: só o segmento do próprio nome (nunca outro CPF, nem mascarado).
          const piece = maskDigits(segs[j].replace(/(?<![A-Za-z])cpf[ \t:.\-]*$/i, '').slice(-100)).replace(/^[\d .\-\/]+(?=\D)/, '');
          add(ln, h, values, `${piece} ${maskCpf(h.cpf)}`.trim().slice(0, 200));
        });
      }
    });
  }

  // Ordem do documento; CPF repetido => primeira ocorrência.
  found.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const people: LocalPerson[] = [];
  for (const f of found) {
    if (seen.has(f.person.cpf)) continue;
    seen.add(f.person.cpf);
    people.push(f.person);
  }
  return people;
}
