export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const onlyDigits = (v: string): string => v.replace(/\D/g, '');

export function isValidCpf(raw: string): boolean {
  if (!/^[\d.\-\s]+$/.test(raw)) return false;
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[len])) return false;
  }
  return true;
}

export function normalizeCbo(raw: unknown): FieldResult<string> {
  const s = String(raw ?? '').trim();
  const d = /^\d+$/.test(s) ? s : '';
  if (d.length === 0 || d.length > 6) return { ok: false, message: 'CBO deve ter até 6 dígitos' };
  return { ok: true, value: d.padStart(6, '0') };
}

export function normalizeSex(raw: unknown): FieldResult<'F' | 'M'> {
  const v = String(raw ?? '').trim().toUpperCase();
  return v === 'F' || v === 'M' ? { ok: true, value: v } : { ok: false, message: 'Sexo deve ser F ou M' };
}

export function normalizeEsocialRegistration(raw: unknown): FieldResult<string> {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9._-]{1,30}$/.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: 'Matrícula eSocial inválida (1 a 30 caracteres, sem espaços)' };
}

export function normalizeIsoDate(raw: unknown): FieldResult<string> {
  const s = String(raw ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const [y, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!y) return { ok: false, message: 'Data inválida (use DD/MM/AAAA)' };
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const real =
    probe.getUTCFullYear() === Number(y) && probe.getUTCMonth() === Number(m) - 1 && probe.getUTCDate() === Number(d);
  return real ? { ok: true, value: `${y}-${m}-${d}` } : { ok: false, message: 'Data inexistente' };
}

const isBlank = (v: unknown): boolean => v === null || (typeof v === 'string' && v.trim() === '');
const PASS_THROUGH = ['company_unit_id', 'position_id'] as const;
const STATUSES = ['ativo', 'inativo', 'pendente'];

export function normalizeEmployeeInput(input: Record<string, unknown>): {
  values: Record<string, unknown>;
  errors: Record<string, string>;
} {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const apply = <T>(field: string, r: FieldResult<T>) => (r.ok ? (values[field] = r.value) : (errors[field] = r.message));

  for (const [field, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    switch (field) {
      case 'full_name':
        typeof raw === 'string' && raw.trim() ? (values[field] = raw.trim()) : (errors[field] = 'Nome é obrigatório');
        break;
      case 'cpf':
        isValidCpf(String(raw)) ? (values[field] = onlyDigits(String(raw))) : (errors[field] = 'CPF inválido');
        break;
      case 'birth_date':
      case 'admission_date':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeIsoDate(raw));
        break;
      case 'sex':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeSex(raw));
        break;
      case 'cbo_code':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeCbo(raw));
        break;
      case 'esocial_registration':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeEsocialRegistration(raw));
        break;
      case 'position':
      case 'activity_description': {
        const max = field === 'position' ? 200 : 2000;
        const t = isBlank(raw) ? null : String(raw).trim();
        t !== null && t.length > max ? (errors[field] = `Máximo de ${max} caracteres`) : (values[field] = t);
        break;
      }
      case 'status':
        STATUSES.includes(String(raw)) ? (values[field] = raw) : (errors[field] = 'Situação inválida');
        break;
      default:
        if ((PASS_THROUGH as readonly string[]).includes(field)) values[field] = isBlank(raw) ? null : raw;
    }
  }
  return { values, errors };
}
