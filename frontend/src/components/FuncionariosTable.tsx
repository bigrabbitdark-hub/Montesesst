'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  brToIso,
  diffRows,
  EDITABLE_COLUMNS,
  formatCpf,
  isoToBr,
  type EmployeeTableRow,
} from '@/lib/employees-table';

const PAGE_SIZE = 50;

type Draft = Record<string, Record<string, string>>;

function displayValue(row: EmployeeTableRow, key: keyof EmployeeTableRow, type: string): string {
  const v = row[key];
  if (key === 'cpf') return formatCpf(String(v ?? ''));
  if (type === 'date') return isoToBr((v as string | null) ?? null);
  return v == null ? '' : String(v);
}

export function FuncionariosTable({
  tenantId,
  companyUnitId,
  refreshKey = 0,
}: {
  tenantId?: string;
  companyUnitId?: string;
  /** Muda para forçar um recarregamento a partir do backend (ex.: após cadastrar). */
  refreshKey?: number;
}) {
  const [original, setOriginal] = useState<EmployeeTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      const token = localStorage.getItem('montese_token');
      let url = `/api/employees/table?limit=${PAGE_SIZE}&offset=${nextOffset}`;
      if (companyUnitId) url += `&company_unit_id=${encodeURIComponent(companyUnitId)}`;
      if (tenantId) url += `&tenant_id=${encodeURIComponent(tenantId)}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.message || 'Não foi possível carregar a tabela de funcionários.');
          return;
        }
        setOriginal(body.items ?? []);
        setTotal(body.total ?? 0);
        setOffset(nextOffset);
      } catch {
        setError('Não foi possível carregar a tabela de funcionários.');
      } finally {
        setLoading(false);
      }
    },
    [tenantId, companyUnitId],
  );

  useEffect(() => {
    void load(0);
  }, [load, refreshKey]);

  function valueOf(row: EmployeeTableRow, key: keyof EmployeeTableRow, type: string): string {
    return draft[row.id]?.[key] ?? displayValue(row, key, type);
  }

  function isChanged(row: EmployeeTableRow, key: keyof EmployeeTableRow, type: string): boolean {
    const typed = draft[row.id]?.[key];
    if (typed === undefined) return false;
    if (key === 'cpf') return typed.replace(/\D/g, '') !== row.cpf;
    return typed !== displayValue(row, key, type);
  }

  function setCell(id: string, key: string, value: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
    setFieldErrors((e) => {
      if (!e[`${id}.${key}`]) return e;
      const rest = { ...e };
      delete rest[`${id}.${key}`];
      return rest;
    });
  }

  const hasChanges = original.some((row) =>
    EDITABLE_COLUMNS.some((c) => isChanged(row, c.key, c.type)),
  );

  function startEdit() {
    setSuccess('');
    setError('');
    setFieldErrors({});
    setDraft({});
    setEditing(true);
  }

  function cancel() {
    setDraft({});
    setFieldErrors({});
    setError('');
    setEditing(false);
  }

  async function refresh() {
    if (
      hasChanges &&
      !window.confirm('Você tem alterações não confirmadas. Atualizar vai descartá-las. Continuar?')
    ) {
      return;
    }
    setSuccess('');
    setError('');
    setFieldErrors({});
    setDraft({});
    setEditing(false);
    await load(offset);
  }

  async function confirm() {
    setSuccess('');
    setError('');
    const localErrors: Record<string, string> = {};
    const draftRows: EmployeeTableRow[] = original.map((row) => {
      const next: Record<string, unknown> = { ...row };
      for (const col of EDITABLE_COLUMNS) {
        if (!isChanged(row, col.key, col.type)) continue;
        const typed = draft[row.id][col.key].trim();
        if (col.type === 'date') {
          if (typed === '') next[col.key] = null;
          else {
            const iso = brToIso(typed);
            if (iso === null) localErrors[`${row.id}.${col.key}`] = 'Data inválida. Use DD/MM/AAAA.';
            else next[col.key] = iso;
          }
        } else if (col.type === 'sex') {
          next[col.key] = typed === '' ? null : typed;
        } else if (col.key === 'cpf') {
          next[col.key] = draft[row.id][col.key].replace(/\D/g, '');
        } else {
          next[col.key] = draft[row.id][col.key];
        }
      }
      return next as unknown as EmployeeTableRow;
    });
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setError('Corrija os campos destacados antes de confirmar.');
      return;
    }
    const changes = diffRows(original, draftRows);
    if (changes.length === 0) return;

    setSaving(true);
    setFieldErrors({});
    try {
      const token = localStorage.getItem('montese_token');
      let url = '/api/employees/bulk';
      if (tenantId) url += `?tenant_id=${encodeURIComponent(tenantId)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ changes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errors = body?.errors && typeof body.errors === 'object' ? body.errors : null;
        if (errors && Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          setError(body?.message || 'Há campos com problema. Corrija e confirme novamente.');
        } else {
          setError(body?.message || 'Não foi possível salvar as alterações.');
        }
        return;
      }
      setDraft({});
      setEditing(false);
      setSuccess('Alterações salvas');
      await load(offset);
    } catch {
      setError('Não foi possível salvar as alterações. Verifique a conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const btn =
    'rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-primary disabled:cursor-not-allowed disabled:opacity-50';
  const inputCls =
    'w-full min-w-[8rem] rounded-md border border-dash-border-soft bg-dash-card px-2 py-1.5 text-sm text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary disabled:border-transparent disabled:bg-transparent data-[changed=true]:border-dash-status-warn-text data-[changed=true]:bg-dash-status-warn-bg';

  return (
    <section className="flex flex-col gap-4" aria-label="Tabela oficial de funcionários">
      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <button type="button" onClick={startEdit} className={`${btn} border border-dash-border-soft text-dash-primary`}>
            Editar tabela
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={confirm}
              disabled={!hasChanges || saving}
              className={`${btn} bg-dash-primary text-white`}
            >
              Confirmar alterações
            </button>
            <button type="button" onClick={cancel} disabled={saving} className={`${btn} border border-dash-border-soft text-dash-primary`}>
              Cancelar
            </button>
          </>
        )}
        <button type="button" onClick={refresh} disabled={saving || loading} className={`${btn} border border-dash-border-soft text-dash-primary`}>
          Atualizar tabela
        </button>
        {saving && <span className="text-sm text-dash-muted">Salvando...</span>}
      </div>

      <div role="status" className="text-sm font-semibold text-dash-status-ok-text">
        {success}
      </div>
      {error && (
        <div role="alert" className="rounded-md bg-dash-status-crit-bg px-3 py-2 text-sm text-dash-status-crit-text">
          {error}
        </div>
      )}

      {loading && original.length === 0 ? (
        <p className="text-dash-muted">Carregando funcionários...</p>
      ) : original.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhum funcionário cadastrado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-dash-border-soft text-dash-muted">
                <th scope="col" className="px-2 py-2 font-semibold">Qtde</th>
                {EDITABLE_COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {original.map((row) => (
                <tr
                  key={row.id}
                  className="mb-3 block rounded-lg border border-dash-border-soft p-3 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0"
                >
                  <td className="flex items-center justify-between gap-3 py-1 md:table-cell md:px-2 md:py-2">
                    <span className="text-xs font-semibold text-dash-muted md:hidden">Qtde</span>
                    <span>{row.sequence}</span>
                  </td>
                  {EDITABLE_COLUMNS.map((c) => {
                    const cellKey = `${row.id}.${c.key}`;
                    const ariaLabel = `${c.label} ${row.full_name}`;
                    const value = valueOf(row, c.key, c.type);
                    const changed = isChanged(row, c.key, c.type);
                    const err = fieldErrors[cellKey];
                    const common = {
                      'aria-label': ariaLabel,
                      'aria-invalid': err ? true : undefined,
                      'aria-describedby': err ? `err-${cellKey}` : undefined,
                      'data-changed': changed ? 'true' : undefined,
                      disabled: !editing || saving,
                      className: inputCls,
                    };
                    return (
                      <td key={c.key} className="flex flex-col gap-1 py-1 md:table-cell md:px-2 md:py-2">
                        <span className="text-xs font-semibold text-dash-muted md:hidden">{c.label}</span>
                        {c.type === 'sex' ? (
                          <select {...common} value={value} onChange={(e) => setCell(row.id, c.key, e.target.value)}>
                            <option value="">(vazio)</option>
                            <option value="F">F</option>
                            <option value="M">M</option>
                          </select>
                        ) : (
                          <input
                            {...common}
                            type="text"
                            value={value}
                            inputMode={c.type === 'date' ? 'numeric' : undefined}
                            placeholder={c.type === 'date' ? 'DD/MM/AAAA' : undefined}
                            onChange={(e) => setCell(row.id, c.key, e.target.value)}
                          />
                        )}
                        {err && (
                          <span id={`err-${cellKey}`} className="text-xs text-dash-status-crit-text">
                            {err}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginação" className="flex items-center justify-between gap-3 text-sm text-dash-muted">
        <span>
          {from}–{to} de {total}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading || editing}
            className={`${btn} border border-dash-border-soft text-dash-primary`}
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => load(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading || editing}
            className={`${btn} border border-dash-border-soft text-dash-primary`}
          >
            Próxima
          </button>
        </span>
      </nav>
    </section>
  );
}
