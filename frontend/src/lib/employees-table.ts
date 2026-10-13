export interface EmployeeTableRow {
  id: string;
  sequence: number;
  row_version: string;
  full_name: string;
  esocial_registration: string | null;
  cpf: string;
  birth_date: string | null;
  sex: 'F' | 'M' | null;
  position: string | null;
  admission_date: string | null;
  cbo_code: string | null;
  activity_description: string | null;
  company_unit_id: string | null;
  status: string;
}

export const EDITABLE_COLUMNS: {
  key: keyof EmployeeTableRow;
  label: string;
  type: 'text' | 'date' | 'sex' | 'cbo';
}[] = [
  { key: 'full_name', label: 'Funcionário', type: 'text' },
  { key: 'esocial_registration', label: 'Matrícula eSocial', type: 'text' },
  { key: 'cpf', label: 'CPF', type: 'text' },
  { key: 'birth_date', label: 'Data de nascimento', type: 'date' },
  { key: 'sex', label: 'Sexo', type: 'sex' },
  { key: 'position', label: 'Função/Cargo', type: 'text' },
  { key: 'admission_date', label: 'Data de admissão', type: 'date' },
  { key: 'cbo_code', label: 'CBO', type: 'cbo' },
  { key: 'activity_description', label: 'Descrição da atividade', type: 'text' },
];

export function formatCpf(cpf: string): string {
  const d = (cpf ?? '').replace(/\D/g, '');
  if (d.length !== 11) return cpf ?? '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isoToBr(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function brToIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || year < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function diffRows(
  original: EmployeeTableRow[],
  draft: EmployeeTableRow[],
): { id: string; row_version: string; fields: Record<string, string | null> }[] {
  const byId = new Map(original.map((r) => [r.id, r]));
  const out: { id: string; row_version: string; fields: Record<string, string | null> }[] = [];
  for (const d of draft) {
    const o = byId.get(d.id);
    if (!o) continue;
    const fields: Record<string, string | null> = {};
    for (const col of EDITABLE_COLUMNS) {
      const before = (o[col.key] ?? '') as string;
      const after = (d[col.key] ?? '') as string;
      if (before !== after) fields[col.key] = after;
    }
    if (Object.keys(fields).length > 0) out.push({ id: o.id, row_version: o.row_version, fields });
  }
  return out;
}
