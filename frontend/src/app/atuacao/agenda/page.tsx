'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { getUser } from '@/lib/auth';
import {
  AGENDA_STATUS_LABEL, AGENDA_STATUS_TONE, AGENDA_TIPO_LABEL, atuacaoFetch, formatDataCurta, formatIntervalo, hojeIso,
  somarDias, type AgendaTipo, type ClienteResumo, type EventoDetalhe, type EventoResumo, type Responsavel,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const HTTPS = /^https:\/\/\S+$/;

function NovoCompromisso({ meuId, onCriado, onFechar }: { meuId: string | null; onCriado: () => void; onFechar: () => void }) {
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [equipe, setEquipe] = useState<Responsavel[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [resp, setResp] = useState(meuId ?? '');
  const [tipo, setTipo] = useState<AgendaTipo>('reuniao');
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [local, setLocal] = useState('');
  const [link, setLink] = useState('');
  const [pauta, setPauta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([atuacaoFetch<ClienteResumo[]>('/clientes'), atuacaoFetch<Responsavel[]>('/equipe')])
      .then(([c, e]) => { setClientes(c); setEquipe(e); setResp((atual) => atual || e[0]?.id || ''); })
      .catch((e: Error) => setErroOpcoes(e.message));
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !titulo.trim() || !data) {
      setErro('Informe cliente, título e data.');
      return;
    }
    // Validação só de UX; o servidor decide.
    if (link.trim() && !HTTPS.test(link.trim())) {
      setErro('O link da reunião deve começar com https://.');
      return;
    }
    if (inicio && fim && fim <= inicio) {
      setErro('O horário final deve ser depois do inicial.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const body: Record<string, string> = { tenant_id: tenantId, type: tipo, title: titulo.trim(), event_date: data };
      if (resp) body.owner_user_id = resp;
      if (inicio) body.start_time = inicio;
      if (fim) body.end_time = fim;
      if (local.trim()) body.location = local.trim();
      if (link.trim()) body.meeting_link = link.trim();
      if (pauta.trim()) body.notes = pauta.trim();
      await atuacaoFetch<EventoDetalhe>('/agenda', { method: 'POST', body: JSON.stringify(body) });
      onCriado();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card title="Novo compromisso">
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2" noValidate>
        {erroOpcoes && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erroOpcoes}</p>}
        <div>
          <label htmlFor="ag-cliente" className={LABEL}>Cliente</label>
          <select id="ag-cliente" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={INPUT}>
            <option value="">Selecione</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ag-resp" className={LABEL}>Responsável do compromisso</label>
          <select id="ag-resp" value={resp} onChange={(e) => setResp(e.target.value)} className={INPUT}>
            {equipe.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ag-tipo" className={LABEL}>Tipo</label>
          <select id="ag-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as AgendaTipo)} className={INPUT}>
            {(Object.keys(AGENDA_TIPO_LABEL) as AgendaTipo[]).map((t) => <option key={t} value={t}>{AGENDA_TIPO_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ag-titulo" className={LABEL}>Título</label>
          <input id="ag-titulo" type="text" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ag-data" className={LABEL}>Data</label>
          <input id="ag-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className={INPUT} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ag-inicio" className={LABEL}>Início</label>
            <input id="ag-inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="ag-fim" className={LABEL}>Fim</label>
            <input id="ag-fim" type="time" value={fim} onChange={(e) => setFim(e.target.value)} className={INPUT} />
          </div>
        </div>
        <div>
          <label htmlFor="ag-local" className={LABEL}>Local</label>
          <input id="ag-local" type="text" maxLength={300} value={local} onChange={(e) => setLocal(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ag-link" className={LABEL}>Link da reunião</label>
          <input id="ag-link" type="url" inputMode="url" maxLength={500} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ag-pauta" className={LABEL}>Pauta</label>
          <textarea id="ag-pauta" rows={3} maxLength={4000} value={pauta} onChange={(e) => setPauta(e.target.value)} className={INPUT} />
        </div>
        {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Criando...' : 'Criar compromisso'}</button>
          <button type="button" onClick={onFechar} className={BTN_SEC}>Fechar</button>
        </div>
      </form>
    </Card>
  );
}

function ItemEvento({ e, meuId, onAtualizado }: { e: EventoResumo; meuId: string | null; onAtualizado: (n: EventoResumo) => void }) {
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const outro = meuId !== null && e.owner_user_id !== meuId;

  async function mudar(status: 'concluido' | 'cancelado', nota?: string) {
    setEnviando(true);
    setErro(null);
    try {
      const body: { status: string; note?: string } = { status };
      if (nota) body.note = nota;
      const nova = await atuacaoFetch<EventoDetalhe>(`/agenda/${e.id}/status`, { method: 'POST', body: JSON.stringify(body) });
      onAtualizado(nova);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function confirmarCancelamento() {
    if (!motivo.trim()) {
      setErro('Informe o motivo.');
      return;
    }
    void mudar('cancelado', motivo.trim());
  }

  return (
    <li className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="break-words text-sm font-semibold text-dash-primary">{e.title}</p>
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={AGENDA_STATUS_TONE[e.status]}>{AGENDA_STATUS_LABEL[e.status]}</Badge>
          {outro && <Badge tone="warn">{`de ${e.owner_name ?? 'outro sócio'}`}</Badge>}
        </span>
      </div>
      <p className="mt-1 text-sm text-dash-primary">{formatIntervalo(e.start_time, e.end_time)}</p>
      <p className="mt-1 break-words text-sm text-dash-muted">
        {AGENDA_TIPO_LABEL[e.type] ?? e.type} · <Link href={`/atuacao/clientes/${e.tenant_id}`} className={LINK}>{e.tenant_name}</Link>
      </p>
      {e.status === 'agendado' && (
        <div className="mt-3">
          {!cancelando && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={enviando} onClick={() => void mudar('concluido')} className={BTN_SEC} aria-label={`Concluir compromisso: ${e.title}`}>
                Concluir
              </button>
              <button type="button" disabled={enviando} onClick={() => { setCancelando(true); setErro(null); }} className={BTN_SEC} aria-label={`Cancelar compromisso: ${e.title}`}>
                Cancelar
              </button>
            </div>
          )}
          {cancelando && (
            <div>
              <label htmlFor={`motivo-${e.id}`} className={LABEL}>Motivo do cancelamento</label>
              <textarea id={`motivo-${e.id}`} rows={2} maxLength={1000} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} className={INPUT} />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={enviando} onClick={confirmarCancelamento} className={BTN_SEC}>Confirmar cancelamento</button>
                <button type="button" onClick={() => { setCancelando(false); setErro(null); }} className={BTN_SEC}>Voltar</button>
              </div>
            </div>
          )}
        </div>
      )}
      {erro && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">{erro}</p>}
    </li>
  );
}

function agrupar(lista: EventoResumo[]): [string, EventoResumo[]][] {
  const mapa = new Map<string, EventoResumo[]>();
  for (const e of lista) mapa.set(e.event_date, [...(mapa.get(e.event_date) ?? []), e]);
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function AgendaPage() {
  const [meuId, setMeuId] = useState<string | null>(null);
  const [responsavel, setResponsavel] = useState<'me' | 'todos'>('me');
  const [de, setDe] = useState(() => hojeIso());
  const [ate, setAte] = useState(() => somarDias(hojeIso(), 14));
  const [data, setData] = useState<EventoResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { setMeuId(getUser()?.id ?? null); }, []);

  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    if (de && ate && ate < de) {
      setData(null);
      setError('A data final deve ser igual ou depois da inicial.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (responsavel === 'me') qs.set('owner', 'me');
    if (de) qs.set('from', de);
    if (ate) qs.set('to', ate);
    atuacaoFetch<EventoResumo[]>(`/agenda?${qs.toString()}`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [responsavel, de, ate]);

  useEffect(carregar, [carregar]);

  function substituir(n: EventoResumo) {
    setData((atual) => (atual ? atual.map((e) => (e.id === n.id ? { ...e, ...n } : e)) : atual));
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Agenda" descricao="Reuniões, visitas e ligações da equipe Montese com os clientes." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_180px_180px] sm:items-end">
        <div>
          <label htmlFor="f-resp" className={LABEL}>Responsável</label>
          <select id="f-resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value as 'me' | 'todos')} className={INPUT}>
            <option value="me">Meus</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-de" className={LABEL}>De</label>
          <input id="f-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="f-ate" className={LABEL}>Até</label>
          <input id="f-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={INPUT} />
        </div>
      </div>
      <div className="mb-4">
        {!criando && (
          <button type="button" onClick={() => { setCriando(true); setAviso(null); }} className={BTN}>Novo compromisso</button>
        )}
        {aviso && <p role="status" className="mt-2 text-sm text-dash-status-ok-text">{aviso}</p>}
      </div>
      {criando && (
        <div className="mb-6">
          <NovoCompromisso
            meuId={meuId}
            onFechar={() => setCriando(false)}
            onCriado={() => { setCriando(false); setAviso('Compromisso criado.'); carregar(); }}
          />
        </div>
      )}
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-48 w-full"
        render={(lista) =>
          lista.length === 0 ? (
            <p className="text-sm text-dash-muted">Nenhum compromisso neste período.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {agrupar(lista).map(([dia, itens]) => (
                <section key={dia} aria-labelledby={`dia-${dia}`}>
                  <h2 id={`dia-${dia}`} className="mb-2 text-base font-semibold text-dash-primary">{formatDataCurta(dia)}</h2>
                  <ul className="flex flex-col gap-3">
                    {itens.map((e) => <ItemEvento key={e.id} e={e} meuId={meuId} onAtualizado={substituir} />)}
                  </ul>
                </section>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}
