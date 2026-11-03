'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, exigeMotivo, formatDataCurta, formatDataHora, PRIORIDADE_LABEL, STATUS_LABEL, STATUS_TONE, TRANSICOES,
  type TarefaDetalhe, type TarefaEvento, type TarefaStatus,
} from '../../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';

const ACAO_LABEL: Record<TarefaStatus, string> = {
  pending: 'Reabrir como pendente', in_progress: 'Iniciar', blocked: 'Bloquear',
  awaiting_review: 'Enviar para revisão', completed: 'Concluir', cancelled: 'Cancelar tarefa',
};
const CAMPO_LABEL: Record<string, string> = {
  title: 'título', description: 'descrição', priority: 'prioridade', due_date: 'prazo', category: 'categoria',
};

function statusTxt(v: string | null): string {
  return v && v in STATUS_LABEL ? STATUS_LABEL[v as TarefaStatus] : (v ?? '');
}

function descreverEvento(e: TarefaEvento): string {
  switch (e.type) {
    case 'created': return 'Tarefa criada';
    case 'assigned': return 'Responsável alterado';
    case 'updated': {
      const campos = (e.to_value ?? '').split(',').map((c) => CAMPO_LABEL[c.trim()] ?? c.trim()).filter(Boolean);
      return campos.length ? `Dados atualizados: ${campos.join(', ')}` : 'Dados atualizados';
    }
    case 'status_changed': return `Status: ${statusTxt(e.from_value)} → ${statusTxt(e.to_value)}`;
    default: return 'Alteração';
  }
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-dash-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-dash-primary">{children}</dd>
    </div>
  );
}

export default function TarefaDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const [tarefa, setTarefa] = useState<TarefaDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [alvo, setAlvo] = useState<TarefaStatus | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<TarefaDetalhe>(`/tarefas/${id}`)
      .then(setTarefa)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(carregar, [carregar]);

  async function enviar(para: TarefaStatus, nota?: string) {
    setEnviando(true);
    setErroAcao(null);
    try {
      const body: { status: TarefaStatus; note?: string } = { status: para };
      if (nota) body.note = nota;
      const nova = await atuacaoFetch<TarefaDetalhe>(`/tarefas/${id}/status`, { method: 'POST', body: JSON.stringify(body) });
      setTarefa(nova);
      setAlvo(null);
      setMotivo('');
    } catch (err) {
      setErroAcao((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function escolher(para: TarefaStatus) {
    setErroAcao(null);
    if (exigeMotivo(para)) {
      setAlvo(para);
      setMotivo('');
    } else {
      void enviar(para);
    }
  }

  function confirmar() {
    if (!alvo) return;
    if (!motivo.trim()) {
      setErroAcao('Informe o motivo.');
      return;
    }
    void enviar(alvo, motivo.trim());
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <Link href="/atuacao/tarefas" className="mb-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2">
        Voltar para tarefas
      </Link>
      <AsyncBody
        data={tarefa}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-64 w-full"
        render={(t) => (
          <>
            <PageHeader titulo={t.title} descricao={`Cliente: ${t.tenant_name}`} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Detalhes">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Situação">
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      {t.vencida && <Badge tone="crit">Vencida</Badge>}
                    </span>
                  </Campo>
                  <Campo label="Prazo">{formatDataCurta(t.due_date)}</Campo>
                  <Campo label="Prioridade">{PRIORIDADE_LABEL[t.priority] ?? t.priority}</Campo>
                  <Campo label="Categoria">{t.category ?? '—'}</Campo>
                  <Campo label="Responsável">{t.assignee_name ?? '—'}</Campo>
                  <Campo label="Criada por">{t.created_by_name ?? '—'}</Campo>
                  <Campo label="Cliente">
                    <Link href={`/atuacao/clientes/${t.tenant_id}`} className={LINK}>{t.tenant_name} (ver ficha do cliente)</Link>
                  </Campo>
                  {t.completed_at && <Campo label="Concluída em">{formatDataHora(t.completed_at)}</Campo>}
                </dl>
                {t.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-dash-primary">{t.description}</p>}

                <div role="group" aria-label="Alterar status" className="mt-6 flex flex-wrap gap-2">
                  {TRANSICOES[t.status].map((para) => (
                    <button key={para} type="button" disabled={enviando} onClick={() => escolher(para)} className={BTN}>
                      {ACAO_LABEL[para]}
                    </button>
                  ))}
                </div>
                {alvo && (
                  <div className="mt-4">
                    <label htmlFor="motivo" className="mb-1 block text-sm font-medium text-dash-muted">Motivo</label>
                    <textarea id="motivo" rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT} />
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={enviando} onClick={confirmar} className={BTN}>Confirmar</button>
                      <button type="button" onClick={() => { setAlvo(null); setErroAcao(null); }} className={BTN}>Voltar</button>
                    </div>
                  </div>
                )}
                {erroAcao && <p role="alert" className="mt-3 text-sm text-dash-status-crit-text">{erroAcao}</p>}
              </Card>

              <Card title="Histórico">
                <ol aria-label="Histórico" className="flex flex-col gap-3">
                  {t.eventos.map((e) => (
                    <li key={e.id} className="border-l-2 border-dash-border-input pl-3 text-sm">
                      <p className="font-medium text-dash-primary">{descreverEvento(e)}</p>
                      <p className="text-xs text-dash-muted">{e.actor_name ?? 'Sistema'} · {formatDataHora(e.created_at)}</p>
                      {e.note && <p className="mt-1 break-words text-dash-primary">{e.note}</p>}
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </>
        )}
      />
    </div>
  );
}
