'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { atuacaoFetch, formatDataCurta, hojeIso, INTERACAO_TIPO_LABEL, type Interacao, type InteracaoTipo } from '../../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

interface Valores { type: InteracaoTipo; occurred_on: string; participants: string; summary: string; decisions: string; next_steps: string }

function vazio(): Valores {
  return { type: 'reuniao', occurred_on: hojeIso(), participants: '', summary: '', decisions: '', next_steps: '' };
}
function deInteracao(i: Interacao): Valores {
  return {
    type: i.type, occurred_on: i.occurred_on, participants: i.participants ?? '', summary: i.summary,
    decisions: i.decisions ?? '', next_steps: i.next_steps ?? '',
  };
}

function Formulario({ tenantId, inicial, editando, onSalvo, onFechar }: {
  tenantId: string; inicial: Valores; editando: Interacao | null; onSalvo: () => void; onFechar: () => void;
}) {
  const [v, setV] = useState<Valores>(inicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const set = <K extends keyof Valores>(k: K, val: Valores[K]) => { setAviso(null); setV((a) => ({ ...a, [k]: val })); };

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    if (!v.occurred_on || !v.summary.trim()) {
      setErro('Informe a data e o resumo.');
      return;
    }
    setEnviando(true);
    try {
      if (editando) {
        // PATCH só do que mudou.
        const orig = deInteracao(editando);
        const body: Record<string, string> = {};
        (Object.keys(v) as (keyof Valores)[]).forEach((k) => {
          const novo = k === 'summary' ? v[k].trim() : v[k];
          if (novo !== orig[k]) body[k] = novo;
        });
        if (Object.keys(body).length === 0) {
          setAviso('Nenhuma alteração para salvar.');
          return;
        }
        await atuacaoFetch<Interacao>(`/interacoes/${editando.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const body: Record<string, string> = { type: v.type, occurred_on: v.occurred_on, summary: v.summary.trim() };
        if (v.participants.trim()) body.participants = v.participants.trim();
        if (v.decisions.trim()) body.decisions = v.decisions.trim();
        if (v.next_steps.trim()) body.next_steps = v.next_steps.trim();
        await atuacaoFetch<Interacao>(`/clientes/${tenantId}/interacoes`, { method: 'POST', body: JSON.stringify(body) });
      }
      onSalvo();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mb-6 grid gap-3 sm:grid-cols-2" noValidate>
      <div>
        <label htmlFor="in-tipo" className={LABEL}>Tipo de contato</label>
        <select id="in-tipo" value={v.type} onChange={(e) => set('type', e.target.value as InteracaoTipo)} className={INPUT}>
          {(Object.keys(INTERACAO_TIPO_LABEL) as InteracaoTipo[]).map((t) => <option key={t} value={t}>{INTERACAO_TIPO_LABEL[t]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="in-data" className={LABEL}>Data do contato</label>
        <input id="in-data" type="date" value={v.occurred_on} onChange={(e) => set('occurred_on', e.target.value)} className={INPUT} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="in-part" className={LABEL}>Participantes</label>
        <input id="in-part" type="text" maxLength={1000} value={v.participants} onChange={(e) => set('participants', e.target.value)} className={INPUT} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="in-resumo" className={LABEL}>Resumo</label>
        <textarea id="in-resumo" rows={3} maxLength={4000} value={v.summary} onChange={(e) => set('summary', e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="in-dec" className={LABEL}>Decisões</label>
        <textarea id="in-dec" rows={3} maxLength={4000} value={v.decisions} onChange={(e) => set('decisions', e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="in-prox" className={LABEL}>Próximos passos</label>
        <textarea id="in-prox" rows={3} maxLength={4000} value={v.next_steps} onChange={(e) => set('next_steps', e.target.value)} className={INPUT} />
      </div>
      {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
      {aviso && <p role="status" className="text-sm text-dash-muted sm:col-span-2">{aviso}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Salvando...' : 'Salvar registro'}</button>
        <button type="button" onClick={onFechar} className={BTN_SEC}>Fechar</button>
      </div>
    </form>
  );
}

function Campo({ rotulo, texto }: { rotulo: string; texto: string | null }) {
  if (!texto) return null;
  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-dash-primary">
      <span className="font-medium text-dash-muted">{rotulo}: </span>{texto}
    </p>
  );
}

export function Interacoes({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Interacao[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState<'novo' | Interacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    atuacaoFetch<Interacao[]>(`/clientes/${tenantId}/interacoes`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [tenantId]);

  useEffect(carregar, [carregar]);

  return (
    <Card title="Reuniões e contatos" className="mt-6">
      <p className="mb-4 text-sm text-dash-muted">Registro interno da equipe Montese. Só quem criou o registro pode editá-lo.</p>
      {aberto === null && (
        <button type="button" onClick={() => { setAberto('novo'); setAviso(null); }} className={`${BTN} mb-4`}>Novo registro</button>
      )}
      {aviso && <p role="status" className="mb-4 text-sm text-dash-status-ok-text">{aviso}</p>}
      {aberto !== null && (
        <Formulario
          key={aberto === 'novo' ? 'novo' : aberto.id}
          tenantId={tenantId}
          inicial={aberto === 'novo' ? vazio() : deInteracao(aberto)}
          editando={aberto === 'novo' ? null : aberto}
          onFechar={() => setAberto(null)}
          onSalvo={() => { setAberto(null); setAviso('Registro salvo.'); carregar(); }}
        />
      )}
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(lista) =>
          lista.length === 0 ? (
            <p className="text-sm text-dash-muted">Nenhum registro de reunião ou contato ainda.</p>
          ) : (
            <ul aria-label="Reuniões e contatos" className="flex flex-col gap-3">
              {lista.map((i) => (
                <li key={i.id} className="border-l-2 border-dash-border-input pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-dash-primary">{formatDataCurta(i.occurred_on)}</span>
                    <Badge tone="info">{INTERACAO_TIPO_LABEL[i.type] ?? i.type}</Badge>
                    <span className="text-xs text-dash-muted">{`de ${i.created_by_name ?? 'outro sócio'}`}</span>
                  </div>
                  <Campo rotulo="Participantes" texto={i.participants} />
                  <Campo rotulo="Resumo" texto={i.summary} />
                  <Campo rotulo="Decisões" texto={i.decisions} />
                  <Campo rotulo="Próximos passos" texto={i.next_steps} />
                  {i.editavel && (
                    <button
                      type="button"
                      onClick={() => { setAberto(i); setAviso(null); }}
                      className={`${BTN_SEC} mt-2`}
                      aria-label={`Editar registro de ${formatDataCurta(i.occurred_on)}`}
                    >
                      Editar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      />
    </Card>
  );
}
