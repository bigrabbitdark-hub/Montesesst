'use client';

import { FormEvent, useRef, useState } from 'react';
import { sessionExpired } from '@/lib/auth';
import { brToIso } from '@/lib/employees-table';

export interface UnitOption {
  id: string;
  name: string;
}

const EMPTY = {
  full_name: '',
  cpf: '',
  registration_number: '',
  birth_date: '',
  sex: '',
  position: '',
  admission_date: '',
  cbo_code: '',
  activity_description: '',
  company_unit_id: '',
};
type Values = typeof EMPTY;
type Errors = Partial<Record<keyof Values, string>>;

const FIELDS: { key: keyof Values; label: string; required?: boolean; kind: 'text' | 'date' | 'sex' | 'unit' }[] = [
  { key: 'full_name', label: 'Funcionário', required: true, kind: 'text' },
  { key: 'cpf', label: 'CPF', required: true, kind: 'text' },
  { key: 'registration_number', label: 'Matrícula (eSocial)', kind: 'text' },
  { key: 'birth_date', label: 'Data de nascimento', kind: 'date' },
  { key: 'sex', label: 'Sexo', kind: 'sex' },
  { key: 'position', label: 'Função/Cargo', kind: 'text' },
  { key: 'admission_date', label: 'Data de admissão', kind: 'date' },
  { key: 'cbo_code', label: 'CBO', kind: 'text' },
  { key: 'activity_description', label: 'Descrição da atividade', kind: 'text' },
  { key: 'company_unit_id', label: 'Filial', kind: 'unit' },
];

export function NovoFuncionarioForm({
  units,
  tenantId,
  onCreated,
  disabled = false,
}: {
  units: UnitOption[];
  tenantId?: string;
  onCreated: () => void;
  /** Bloqueia abrir o cadastro (e oculta o formulário aberto, preservando o digitado). */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const sendingRef = useRef(false);

  function set(key: keyof Values, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  function close() {
    setOpen(false);
    setValues(EMPTY);
    setErrors({});
    setError('');
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (sendingRef.current) return;
    setSuccess('');
    setError('');

    const found: Errors = {};
    const name = values.full_name.trim();
    const cpf = values.cpf.replace(/\D/g, '');
    if (!name) found.full_name = 'Nome é obrigatório';
    if (cpf.length !== 11) found.cpf = 'CPF inválido';
    const body: Record<string, string> = {};
    for (const f of FIELDS) {
      if (f.key === 'full_name' || f.key === 'cpf') continue;
      const typed = values[f.key].trim();
      if (typed === '') continue;
      if (f.kind === 'date') {
        const iso = brToIso(typed);
        if (iso === null) found[f.key] = 'Data inválida. Use DD/MM/AAAA.';
        else body[f.key] = iso;
      } else {
        body[f.key] = typed;
      }
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    const payload: Record<string, string> = { full_name: name, cpf, ...body };
    if (tenantId) payload.tenant_id = tenantId;

    sendingRef.current = true;
    setSending(true);
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
        setError(msg || 'Não foi possível cadastrar o funcionário.');
        return;
      }
      close();
      setSuccess('Funcionário cadastrado');
      onCreated();
    } catch {
      setError('Não foi possível cadastrar o funcionário. Verifique a conexão e tente novamente.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const btn =
    'rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-primary disabled:cursor-not-allowed disabled:opacity-50';
  const inputCls =
    'w-full rounded-md border border-dash-border-soft bg-dash-card px-2 py-1.5 text-sm text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary';

  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSuccess('');
              setOpen(true);
            }}
            disabled={disabled}
            className={`${btn} bg-dash-primary text-white`}
          >
            Adicionar funcionário
          </button>
          <div role="status" className="text-sm font-semibold text-dash-status-ok-text">
            {success}
          </div>
        </div>
      )}
      {open && (
        <form
          onSubmit={submit}
          noValidate
          aria-label="Novo funcionário"
          hidden={disabled}
          className="flex flex-col gap-4 rounded-lg border border-dash-border-soft p-4"
        >
          <h2 className="text-base font-semibold text-dash-primary">Novo funcionário</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => {
              const id = `novo-func-${f.key}`;
              const err = errors[f.key];
              const common = {
                id,
                value: values[f.key],
                disabled: sending,
                'aria-required': f.required ? true : undefined,
                'aria-invalid': err ? true : undefined,
                'aria-describedby': err ? `${id}-err` : undefined,
                className: inputCls,
              };
              return (
                <div key={f.key} className="flex flex-col gap-1">
                  <label htmlFor={id} className="text-xs font-semibold text-dash-muted">
                    {f.label}
                    {f.required ? ' (obrigatório)' : ''}
                  </label>
                  {f.kind === 'sex' ? (
                    <select {...common} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">(vazio)</option>
                      <option value="F">F</option>
                      <option value="M">M</option>
                    </select>
                  ) : f.kind === 'unit' ? (
                    <select {...common} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">(sem filial)</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type="text"
                      inputMode={f.kind === 'date' ? 'numeric' : undefined}
                      placeholder={f.kind === 'date' ? 'DD/MM/AAAA' : undefined}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                  {err && (
                    <span id={`${id}-err`} className="text-xs text-dash-status-crit-text">
                      {err}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <div role="alert" className="rounded-md bg-dash-status-crit-bg px-3 py-2 text-sm text-dash-status-crit-text">
              {error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={sending} className={`${btn} bg-dash-primary text-white`}>
              {sending ? 'Cadastrando...' : 'Cadastrar funcionário'}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={sending}
              className={`${btn} border border-dash-border-soft text-dash-primary`}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
