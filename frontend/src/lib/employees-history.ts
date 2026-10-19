export interface HistoryItem {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor_role: string | null;
  source: string;
  changed_at: string;
}

export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Funcionário',
  cpf: 'CPF',
  birth_date: 'Data de nascimento',
  sex: 'Sexo',
  position: 'Função/Cargo',
  admission_date: 'Data de admissão',
  esocial_registration: 'Matrícula eSocial',
  cbo_code: 'CBO',
  activity_description: 'Descrição da atividade',
  company_unit_id: 'Filial',
  status: 'Situação',
};

const DATE_FIELDS = new Set(['birth_date', 'admission_date']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatHistoryValue(field: string, value: string | null): string {
  if (value === null || value === '') return '—';
  if (DATE_FIELDS.has(field)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }
  // O histórico guarda só o id da filial; o nome exigiria outra consulta (YAGNI nesta fatia).
  if (field === 'company_unit_id' && UUID_RE.test(value)) return 'Outra filial';
  return value;
}

const SOURCES: Record<string, string> = {
  cadastro: 'Cadastro',
  tabela: 'Edição da tabela',
  importacao: 'Importação',
  documento: 'Documento',
  revisao: 'Revisão',
};
export const sourceLabel = (s: string): string => SOURCES[s] ?? 'Outra origem';

export function roleLabel(role: string | null): string {
  if (role === 'empresa') return 'Empresa';
  if (role === 'admin') return 'Administrador Montese';
  return 'Sistema';
}

export function formatChangedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // h23 evita "24:xx" à meia-noite que hour12:false pode gerar em alguns ICU.
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}
