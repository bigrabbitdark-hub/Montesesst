'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, formatDataHora, NOTIFICACAO_PRIORIDADE_LABEL, notificacaoTone, type Notificacao,
} from '../api';

const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LINK = 'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';

export default function NotificacoesPage() {
  const [naoLidas, setNaoLidas] = useState(false);
  const [data, setData] = useState<{ itens: Notificacao[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ultima = useRef(0);

  const carregar = useCallback((silencioso = false) => {
    const n = ++ultima.current;
    if (!silencioso) setLoading(true);
    setError(null);
    return atuacaoFetch<{ itens: Notificacao[]; total: number }>(`/notificacoes${naoLidas ? '?naoLidas=true' : ''}`)
      .then((d) => { if (n === ultima.current) setData(d); })
      .catch((e: Error) => { if (n === ultima.current) setError(e.message); })
      .finally(() => { if (n === ultima.current) setLoading(false); });
  }, [naoLidas]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function marcar(id: string | null) {
    if (ocupado) return;
    setOcupado(true);
    setErroAcao(null);
    try {
      await atuacaoFetch(id ? `/notificacoes/${id}/lida` : '/notificacoes/lidas', { method: 'POST' });
      await carregar(true);
    } catch (e) {
      setErroAcao((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Notificações" descricao="Vencimentos próximos, atrasos e revisões por mudança nas condições de trabalho da carteira Montese." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-dash-primary">
          <input type="checkbox" checked={naoLidas} onChange={(e) => setNaoLidas(e.target.checked)} /> Mostrar só não lidas
        </label>
        <button type="button" className={BTN_SEC} disabled={ocupado || !data || data.itens.every((n) => n.read_at)} onClick={() => void marcar(null)}>Marcar todas como lidas</button>
        <Link href="/atuacao/alertas" className={`${LINK} text-sm`}>Regras e revisões por mudança</Link>
      </div>
      {erroAcao && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erroAcao}</p>}
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-40 w-full"
        render={(d) => d.itens.length === 0 ? (
          <p className="text-sm text-dash-muted">{naoLidas ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação por enquanto. Elas são geradas todos os dias pela manhã.'}</p>
        ) : (
          <>
            <ul aria-label="Notificações" className="flex flex-col gap-3">
              {d.itens.map((n) => (
                <li key={n.id} className={`rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)] ${n.read_at ? 'opacity-70' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={notificacaoTone(n.priority)}>{NOTIFICACAO_PRIORIDADE_LABEL[n.priority]}</Badge>
                    <span className={`text-sm text-dash-primary ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-dash-muted">
                    <span>{formatDataHora(n.created_at)}</span>
                    {n.href && <Link href={n.href} className={LINK} onClick={() => { if (!n.read_at) void marcar(n.id); }}>Abrir</Link>}
                    {!n.read_at && <button type="button" className={BTN_SEC} disabled={ocupado} onClick={() => void marcar(n.id)} aria-label={`Marcar como lida: ${n.title}`}>Marcar como lida</button>}
                    {n.read_at && <span>Lida</span>}
                  </div>
                </li>
              ))}
            </ul>
            {d.total > d.itens.length && <p className="mt-3 text-xs text-dash-muted">Mostrando as {d.itens.length} mais recentes de {d.total}.</p>}
          </>
        )}
      />
    </div>
  );
}
