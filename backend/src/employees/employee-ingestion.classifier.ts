import { normalizeEmployeeInput, onlyDigits } from './employee-fields.util';
import { SheetRow } from './employee-sheet.parser';

export const COMPARABLE_FIELDS = [
  'full_name', 'registration_number', 'birth_date', 'sex', 'position', 'admission_date', 'cbo_code', 'activity_description',
] as const;
const TEXT_FIELDS = new Set(['full_name', 'position', 'activity_description']);

export interface ExistingEmployee {
  id: string; cpf: string; company_unit_id: string | null; full_name: string;
  registration_number: string | null; birth_date: string | null; sex: string | null; position: string | null;
  admission_date: string | null; cbo_code: string | null; activity_description: string | null;
}
export interface FieldConflict { field: string; current: string; proposed: string }
export type Candidate =
  | { line: number; kind: 'novo'; values: Record<string, string>; evidence?: string }
  | { line: number; kind: 'conflito'; employee_id: string; full_name: string; cpf: string; conflicts: FieldConflict[]; reason?: 'outra_filial'; suggestions?: { field: string; proposed: string }[]; evidence?: string }
  | { line: number; kind: 'sugestao'; employee_id: string; full_name: string; cpf: string; suggestions: { field: string; proposed: string }[]; evidence?: string }
  | { line: number; kind: 'invalida'; reason: string };
export interface AutoApply { line: number; employee_id: string; values: Record<string, string> }
export interface ClassifyResult { autoApply: AutoApply[]; candidates: Candidate[]; unchanged: number }

// O Excel entrega CPF numérico sem o zero à esquerda; restaura só quando não há pontuação e faltam 1–2 dígitos.
function restoreCpf(raw: string | undefined): string {
  const v = raw ?? '';
  const d = onlyDigits(v);
  return /^\d+$/.test(v.trim()) && d.length >= 9 && d.length < 11 ? d.padStart(11, '0') : v;
}

// Tolera undefined como vazio (o contrato pede null, mas nunca deve lançar).
const same = (field: string, a: string | null | undefined, b: string) =>
  TEXT_FIELDS.has(field) ? (a ?? '').trim().toLowerCase() === b.trim().toLowerCase() : (a ?? '') === b;

interface PreparedRow {
  line: number; cpf: string | null; values: Record<string, string> | null; reviewOnly: Set<string>; evidence?: string;
}

const EVIDENCE_MAX = 200;
// Defesa em profundidade: o chamador já mascara, mas o classificador nunca guarda 9+ dígitos
// (com até 8 separadores não alfanuméricos entre eles) nem CPF formatado, nem em grafias espaçadas.
const DIGIT_RUN = /\p{Nd}(?:[^\p{L}\p{N}]{0,8}\p{Nd}){8,}/gu;
const FORMATTED_CPF = /\p{Nd}{3}[.\s]\p{Nd}{3}[.\s]\p{Nd}{3}[-\s]\p{Nd}{2}/gu;
// Rótulos de marcador (`[CPF_n]`, `[MAT_n]`, `[CBO_n]`, com ou sem número) NÃO são protegidos: o chamador já mascara,
// e proteger o rótulo abria brecha (letras quebravam a corrida de dígitos). Viram separador e os dígitos do número
// participam da corrida; `[CPF_1]` colado a dígitos fica ilegível (over-masking aceito).
const MARKER_LIKE = /\[(?:CPF|MAT|CBO)(?:_(\p{Nd}*))?\]/giu;
const RAW_CAP = 20000; // teto de varredura: evidence legítima tem ≤ 200; evita NFKC/regex em texto gigante
function sanitizeEvidence(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let t = raw.slice(0, RAW_CAP);
  // Se cortou o bruto, descarta a cauda sem letras: ela poderia ser um pedaço de CPF.
  if (raw.length > RAW_CAP) t = t.replace(/[^\p{L}]*$/u, '');
  // NFKC antes da varredura: sobrescritos, circulados e largura total viram dígitos comuns.
  t = t.normalize('NFKC').replace(MARKER_LIKE, (_m, d: string | undefined) => ` ${d ?? ''} `);
  // Mascara antes de cortar: o corte nunca deixa um pedaço de CPF sem máscara.
  t = t.replace(FORMATTED_CPF, '[CPF removido]').replace(DIGIT_RUN, '[CPF removido]');
  const masked = t.trim().slice(0, EVIDENCE_MAX);
  return masked === '' ? undefined : masked;
}
const REVIEWABLE = new Set<string>(COMPARABLE_FIELDS);
// Falha fechado: ausente/null = nenhum campo; malformado (não é array de nomes válidos) = TODOS os campos
// da linha viram reviewOnly, de modo que nada dela é auto-aplicado.
function sanitizeReviewOnly(raw: unknown): Set<string> {
  if (raw === undefined || raw === null) return new Set();
  // length > 64 é malformado antes de iterar (array esparso gigante não pode travar o every).
  if (Array.isArray(raw) && raw.length <= 64 && raw.every((f) => typeof f === 'string' && REVIEWABLE.has(f))) return new Set<string>(raw);
  return new Set<string>(COMPARABLE_FIELDS);
}

// Normaliza e valida cada linha uma única vez; usado por classifyRows e normalizedCpfs.
// `cpf` é o CPF normalizado sempre que o CPF da linha é válido, mesmo com outros campos inválidos
// (conta na detecção de repetição); `values` só existe quando a linha inteira é válida.
function prepareRows(rows: SheetRow[]): PreparedRow[] {
  // Falha fechado: a Task 4 liga candidatos a linhas por `line`; repetida seria ambíguo.
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.line)) throw new Error('Linhas duplicadas na entrada do classificador');
    seen.add(r.line);
  }
  return rows.map((r) => {
    // Só os campos conhecidos entram na normalização: chaves extras da linha são descartadas.
    // Valor que não é texto (objeto/array/número) invalida a linha: nunca vira "[object Object]".
    const raws = r.values as Record<string, unknown>;
    const malformed = ['cpf', ...COMPARABLE_FIELDS].some((f) => raws[f] !== undefined && raws[f] !== null && typeof raws[f] !== 'string');
    if (malformed) {
      // O CPF ainda conta na detecção de repetição quando é texto válido.
      let badCpf: string | null = null;
      if (typeof raws.cpf === 'string') {
        const n = normalizeEmployeeInput({ cpf: restoreCpf(raws.cpf), full_name: 'X' }).values.cpf;
        badCpf = typeof n === 'string' ? n : null;
      }
      return { line: r.line, cpf: badCpf, values: null, reviewOnly: new Set<string>() };
    }
    const input: Record<string, unknown> = { cpf: restoreCpf(r.values.cpf), full_name: r.values.full_name };
    for (const f of COMPARABLE_FIELDS) if (f !== 'full_name') input[f] = (r.values as Record<string, string | undefined>)[f];
    const { values, errors } = normalizeEmployeeInput(input);
    const cpf = typeof values.cpf === 'string' ? values.cpf : null;
    const reviewOnly = sanitizeReviewOnly(r.reviewOnly);
    if (Object.keys(errors).length > 0 || cpf === null || typeof values.full_name !== 'string') {
      return { line: r.line, cpf, values: null, reviewOnly };
    }
    // Só cpf, nome e campos comparáveis: nunca repassa status, position_id ou company_unit_id vindos da linha.
    const clean: Record<string, string> = { cpf, full_name: values.full_name };
    for (const f of COMPARABLE_FIELDS) {
      const v = values[f];
      if (typeof v === 'string' && v !== '') clean[f] = v;
    }
    const evidence = sanitizeEvidence(r.evidence);
    return { line: r.line, cpf, values: clean, reviewOnly, ...(evidence ? { evidence } : {}) };
  });
}

// CPFs válidos (normalizados) da planilha, sem repetição: a Task 4 usa para consultar o banco.
export function normalizedCpfs(rows: SheetRow[]): string[] {
  return [...new Set(prepareRows(rows).flatMap((p) => (p.values ? [p.values.cpf] : [])))];
}

// Contratos que o chamador (Task 4) deve respeitar:
// - as chaves de `existingByCpf` são CPFs só com dígitos (11);
// - `birth_date`/`admission_date` de ExistingEmployee vêm como texto YYYY-MM-DD, nunca Date;
// - os campos de ExistingEmployee vazios devem ser `null` (nunca `undefined`); `undefined` é tolerado como vazio;
// - o classificador não distingue funcionário inativo (o chamador decide o que fazer com ele).
export function classifyRows(rows: SheetRow[], existingByCpf: Map<string, ExistingEmployee>, defaultUnitId: string | null): ClassifyResult {
  const result: ClassifyResult = { autoApply: [], candidates: [], unchanged: 0 };
  const prepared = prepareRows(rows);
  const count = new Map<string, number>();
  for (const p of prepared) if (p.cpf) count.set(p.cpf, (count.get(p.cpf) ?? 0) + 1);

  const valid: { line: number; values: Record<string, string>; reviewOnly: Set<string>; evidence?: string }[] = [];
  for (const p of prepared) {
    if (p.cpf && (count.get(p.cpf) ?? 0) > 1) {
      result.candidates.push({ line: p.line, kind: 'invalida', reason: 'CPF repetido na planilha' });
    } else if (!p.values) {
      result.candidates.push({ line: p.line, kind: 'invalida', reason: 'Dados inválidos ou ausentes (confira nome, CPF e os demais campos)' });
    } else valid.push({ line: p.line, values: p.values, reviewOnly: p.reviewOnly, evidence: p.evidence });
  }

  for (const v of valid) {
    const ev = v.evidence ? { evidence: v.evidence } : {};
    const existing = existingByCpf.get(v.values.cpf);
    if (!existing) {
      result.candidates.push({ line: v.line, kind: 'novo', values: { ...v.values, ...(defaultUnitId ? { company_unit_id: defaultUnitId } : {}) }, ...ev });
      continue;
    }
    if (existing.company_unit_id && defaultUnitId && existing.company_unit_id !== defaultUnitId) {
      result.candidates.push({
        line: v.line, kind: 'conflito', employee_id: existing.id, full_name: existing.full_name, cpf: existing.cpf, conflicts: [], reason: 'outra_filial', ...ev,
      });
      continue;
    }
    const fills: Record<string, string> = {};
    const conflicts: FieldConflict[] = [];
    const suggestions: { field: string; proposed: string }[] = [];
    for (const f of COMPARABLE_FIELDS) {
      const proposed = v.values[f];
      if (proposed === undefined) continue; // célula vazia nunca apaga
      const current = existing[f];
      if (current === null || current === undefined || current === '') {
        // Campo reviewOnly (texto livre/IA) nunca é auto-aplicado: vira sugestão para revisão.
        if (v.reviewOnly.has(f)) suggestions.push({ field: f, proposed });
        else fills[f] = proposed;
      }
      else if (!same(f, current, proposed)) conflicts.push({ field: f, current, proposed });
    }
    if (Object.keys(fills).length > 0) result.autoApply.push({ line: v.line, employee_id: existing.id, values: fills });
    // Um item por linha: com conflitos, as sugestões da mesma linha vão junto no `conflito`.
    if (conflicts.length > 0) {
      result.candidates.push({
        line: v.line, kind: 'conflito', employee_id: existing.id, full_name: existing.full_name, cpf: existing.cpf, conflicts,
        ...(suggestions.length > 0 ? { suggestions } : {}), ...ev,
      });
    } else if (suggestions.length > 0) {
      result.candidates.push({ line: v.line, kind: 'sugestao', employee_id: existing.id, full_name: existing.full_name, cpf: existing.cpf, suggestions, ...ev });
    } else if (Object.keys(fills).length === 0) result.unchanged++;
  }
  result.candidates.sort((a, b) => a.line - b.line);
  return result;
}
