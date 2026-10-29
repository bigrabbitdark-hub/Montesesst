'use client';

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { getUser } from '@/lib/auth';
import {
  atuacaoFetch, formatDataCurta, PRIORIDADE_LABEL, STATUS_LABEL, STATUS_TONE,
  type ClienteResumo, type Prioridade, type Responsavel, type TarefaDetalhe, type TarefaResumo, type TarefaStatus,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';

function Marcas({ t, meuId }: { t: TarefaResumo; meuId: string | null }) {
  const outro = meuId !== null && t.assignee_user_id !== meuId;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
      {t.vencida && <Badge tone="crit">Vencida</Badge>}
      {outro && <Badge tone="warn">{`de ${t.assignee_name ?? 'outro sócio'}`}</Badge>}
    </span>
  );
}

function NovaTarefa({ meuId, onCriada, onFechar }: { meuId: string | null; onCriada: () => void; onFechar: () => void }) {
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [equipe, setEquipe] = useState<Responsavel[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [resp, setResp] = useState(meuId ?? '');
  const [prazo, setPrazo] = useState('');
  const [prioridade, setPrioridade] = useState<Prioridade>('media');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([atuacaoFetch<ClienteResumo[]>('/clientes'), atuacaoFetch<Responsavel[]>('/equipe')])
      .then(([c, e]) => { setClientes(c); setEquipe(e); setResp((atual) => atual || e[0]?.id || ''); })
      .catch((e: Error) => setErroOpcoes(e.message));
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !titulo.trim() || !resp) {
      setErro('Informe cliente, título e responsável.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const body: Record<string, string> = {
        tenant_id: tenantId, title: titulo.trim(), assignee_user_id: resp, priority: prioridade,
      };
      if (prazo) body.due_date = prazo;
      await atuacaoFetch<TarefaDetalhe>('/tarefas', { method: 'POST', body: JSON.stringify(body) });
      onCriada();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card title="Nova tarefa">
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2" noValidate>
        {erroOpcoes && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erroOpcoes}</p>}
        <div>
          <label htmlFor="nt-cliente" className="mb-1 block text-sm font-medium text-dash-muted">Cliente</label>
          <select id="nt-cliente" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={INPUT}>
            <option value="">Selecione</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nt-resp" className="mb-1 block text-sm font-medium text-dash-muted">Responsável da tarefa</label>
          <select id="nt-resp" value={resp} onChange={(e) => setResp(e.target.value)} className={INPUT}>
            {equipe.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="nt-titulo" className="mb-1 block text-sm font-medium text-dash-muted">Título</label>
          <input id="nt-titulo" type="text" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="nt-prazo" className="mb-1 block text-sm font-medium text-dash-muted">Prazo</label>
          <input id="nt-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="nt-prio" className="mb-1 block text-sm font-medium text-dash-muted">Prioridade</label>
          <select id="nt-prio" value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)} className={INPUT}>
            {(Object.keys(PRIORIDADE_LABEL) as Prioridade[]).map((p) => <option key={p} value={p}>{PRIORIDADE_LABEL[p]}</option>)}
          </select>
        </div>
        {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Criando...' : 'Criar tarefa'}</button>
          <button type="button" onClick={onFechar} className="rounded-md border border-dash-border-input px-4 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary">
            Fechar
          </button>
        </div>
      </form>
    </Card>
  );
}

function TarefasConteudo() {
  const params = useSearchParams();
  const tenantId = params.get('tenantId') ?? '';
  const [meuId, setMeuId] = useState<string | null>(null);
  const [responsavel, setResponsavel] = useState<'me' | 'todas'>('me');
  const statusUrl = params.get('status') ?? '';
  const statusUrlValido = statusUrl in STATUS_LABEL ? statusUrl : '';
  const [status, setStatus] = useState(statusUrlValido);
  // ?vencidas=true (links do painel) liga o filtro; qualquer outro valor é ignorado. O backend só aceita 'true'.
  const vencidasUrl = params.get('vencidas') === 'true';
  const [vencidas, setVencidas] = useState(vencidasUrl);
  const [data, setData] = useState<TarefaResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { setMeuId(getUser()?.id ?? null); }, []);
  // Navegação dentro da própria página (ex.: link do painel) muda a URL sem remontar o componente.
  useEffect(() => { setVencidas(vencidasUrl); }, [vencidasUrl]);
  useEffect(() => { setStatus(statusUrlValido); }, [statusUrlValido]);

  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (responsavel === 'me') qs.set('assignee', 'me');
    if (status) qs.set('status', status);
    if (vencidas) qs.set('vencidas', 'true');
    if (tenantId) qs.set('tenantId', tenantId);
    const sufixo = qs.toString();
    atuacaoFetch<TarefaResumo[]>(`/tarefas${sufixo ? `?${sufixo}` : ''}`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [responsavel, status, vencidas, tenantId]);

  useEffect(carregar, [carregar]);

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Tarefas" descricao="Acompanhe o que está com você e com os outros sócios." />
      {tenantId && (
        <p className="mb-3 text-sm text-dash-muted">
          Filtrando por um cliente. <Link href="/atuacao/tarefas" className={LINK}>Limpar filtro de cliente</Link>
        </p>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_220px_auto] sm:items-end">
        <div>
          <label htmlFor="f-resp" className="mb-1 block text-sm font-medium text-dash-muted">Responsável</label>
          <select id="f-resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value as 'me' | 'todas')} className={INPUT}>
            <option value="me">Minhas</option>
            <option value="todas">Todas</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-sm font-medium text-dash-muted">Status</label>
          <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as TarefaStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 py-2 text-sm text-dash-primary">
          <input type="checkbox" checked={vencidas} onChange={(e) => setVencidas(e.target.checked)} className="h-4 w-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary" />
          Somente vencidas
        </label>
      </div>
      <div className="mb-4">
        {!criando && (
          <button type="button" onClick={() => { setCriando(true); setAviso(null); }} className={BTN}>Nova tarefa</button>
        )}
        {aviso && <p role="status" className="text-sm text-dash-status-ok-text">{aviso}</p>}
      </div>
      {criando && (
        <div className="mb-6">
          <NovaTarefa
            meuId={meuId}
            onFechar={() => setCriando(false)}
            onCriada={() => { setCriando(false); setAviso('Tarefa criada.'); carregar(); }}
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
            <p className="text-sm text-dash-muted">Nenhuma tarefa encontrada.</p>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)] md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <caption className="sr-only">Tarefas</caption>
                  <thead className="text-xs uppercase text-dash-muted">
                    <tr>
                      <th scope="col" className="w-[34%] px-4 py-3">Tarefa</th>
                      <th scope="col" className="px-4 py-3">Cliente</th>
                      <th scope="col" className="w-28 px-4 py-3">Prazo</th>
                      <th scope="col" className="w-24 px-4 py-3">Prioridade</th>
                      <th scope="col" className="px-4 py-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((t) => (
                      <tr key={t.id} className="border-t border-dash-border-input align-top">
                        <td className="break-words px-4 py-3"><Link href={`/atuacao/tarefas/${t.id}`} className={LINK}>{t.title}</Link></td>
                        <td className="break-words px-4 py-3">{t.tenant_name}</td>
                        <td className="px-4 py-3">{formatDataCurta(t.due_date)}</td>
                        <td className="px-4 py-3">{PRIORIDADE_LABEL[t.priority] ?? t.priority}</td>
                        <td className="px-4 py-3"><Marcas t={t} meuId={meuId} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {lista.map((t) => (
                  <li key={t.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <Link href={`/atuacao/tarefas/${t.id}`} className={`${LINK} break-words`}>{t.title}</Link>
                    <p className="mt-1 break-words text-sm text-dash-muted">{t.tenant_name}</p>
                    <p className="mt-1 text-sm">{formatDataCurta(t.due_date)} · {PRIORIDADE_LABEL[t.priority] ?? t.priority}</p>
                    <div className="mt-2"><Marcas t={t} meuId={meuId} /></div>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      />
    </div>
  );
}

export default function TarefasPage() {
  // useSearchParams exige Suspense no build do Next.
  return (
    <Suspense fallback={null}>
      <TarefasConteudo />
    </Suspense>
  );
}
