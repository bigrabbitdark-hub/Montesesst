'use client';

import { useState } from 'react';
import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatDateTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { AuditLogRow } from '../types';
import { LOG_TONE, logLevel } from './labels';
import type { LogLevel } from './labels';

const FILTROS = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'ERRO', label: 'Erro' },
  { id: 'AVISO', label: 'Aviso' },
  { id: 'INFO', label: 'Info' },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

// Rotulado "Auditoria": são as ações registradas em audit_log, não logs de
// aplicação. NÃO exibe `detail` (pode conter e-mail em falhas de login).
export function RecentLogsCard({ state, className = '' }: { state: FetchState<AuditLogRow[]>; className?: string }) {
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  return (
    <Card
      id="logs"
      title="Logs recentes"
      subtitle="Auditoria — ações registradas"
      action={<CardLink href="/admin/auditoria">Ver todos</CardLink>}
      className={className}
    >
      <div role="group" aria-label="Filtrar por nível" className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              filtro === f.id
                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                : 'border-brand-100 text-brand-700 hover:text-brand-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <AsyncBody state={state} rows={5}>
        {(rows) => {
          const visiveis = rows.filter((r) => filtro === 'TODOS' || logLevel(r.status_code) === (filtro as LogLevel));
          if (rows.length === 0) return <CardEmpty>Nenhum evento registrado.</CardEmpty>;
          if (visiveis.length === 0) return <CardEmpty>Nenhum evento neste nível.</CardEmpty>;
          return (
            <ul className="flex flex-col">
              {visiveis.map((r) => {
                const level = logLevel(r.status_code);
                return (
                  <li key={r.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-t border-brand-100 py-2 text-xs">
                    <span className="text-brand-700">{formatDateTime(r.occurred_at)}</span>
                    <Badge tone={LOG_TONE[level]}>{level}</Badge>
                    <span className="min-w-0 truncate text-brand-900">
                      {`${r.resource_type} · ${r.action}`}
                      {r.ip_address && <span className="text-brand-700">{` · ${r.ip_address}`}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
