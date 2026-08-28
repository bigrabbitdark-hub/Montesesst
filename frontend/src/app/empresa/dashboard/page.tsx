'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TenantData {
  name: string;
  trade_name: string | null;
}

type DashboardStatus = 'ok' | 'atencao' | 'critico';
type AttentionPriority = 'alta' | 'media' | 'baixa';

interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: 'empresa' | 'tecnico';
  link: string;
}

interface DashboardSummary {
  status: DashboardStatus;
  score: number | null;
  updated_at: string;
  resumo: {
    pendencias: number;
    avisos: number;
    acoes_concluidas: number;
    inspecoes_pendentes: number;
  };
  atencao: AttentionItem[];
  proximos_eventos: AttentionItem[];
}

const STATUS_META: Record<DashboardStatus, { emoji: string; label: string; className: string }> = {
  ok: { emoji: '🟢', label: 'Tudo em dia', className: 'bg-green-50 text-green-800 border-green-200' },
  atencao: { emoji: '🟡', label: 'Precisa de atenção', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  critico: { emoji: '🔴', label: 'Pendências críticas', className: 'bg-red-50 text-red-800 border-red-200' },
};

const PRIORITY_META: Record<AttentionPriority, { label: string; className: string }> = {
  alta: { label: 'Urgente', className: 'bg-red-100 text-red-800' },
  media: { label: 'Em breve', className: 'bg-amber-100 text-amber-800' },
  baixa: { label: 'Acompanhar', className: 'bg-brand-50 text-brand-700' },
};

const RESPONSAVEL_LABEL: Record<AttentionItem['responsavel'], string> = {
  empresa: 'Responsável: sua empresa',
  tecnico: 'Responsável: técnico',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const priority = PRIORITY_META[item.prioridade];
  return (
    <Link
      href={item.link}
      className="flex items-center justify-between gap-4 rounded-md border border-brand-100 px-4 py-3 hover:border-brand-500"
    >
      <div>
        <p className="text-sm font-medium text-brand-900">{item.titulo}</p>
        <p className="mt-0.5 text-xs text-brand-700">
          {RESPONSAVEL_LABEL[item.responsavel]}
          {item.data && <> · {formatDate(item.data)}</>}
        </p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${priority.className}`}>
        {priority.label}
      </span>
    </Link>
  );
}

function IndicatorCard({
  emoji,
  label,
  count,
  className,
  expanded,
  onToggle,
  items,
}: {
  emoji: string;
  label: string;
  count: number;
  className: string;
  expanded: boolean;
  onToggle: () => void;
  items: AttentionItem[];
}) {
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold">
          {emoji} {label}
        </span>
        <span className="text-lg font-bold">{count}</span>
      </button>
      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3">
          {items.length === 0 ? (
            <p className="text-xs opacity-80">Nada por aqui.</p>
          ) : (
            items.map((item, i) => (
              <Link key={i} href={item.link} className="text-xs underline hover:no-underline">
                {item.titulo}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function EmpresaDashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    const headers = { Authorization: `Bearer ${token}` };
    fetch('/api/tenants/me', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then(setTenant)
      .catch(() => {});
    fetch('/api/dashboard/summary', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSummary)
      .catch(() => {});
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const status = summary ? STATUS_META[summary.status] : null;
  const pendenciasItems = summary?.atencao.filter((i) => i.prioridade === 'alta') ?? [];
  const avisosItems = summary?.atencao.filter((i) => i.prioridade === 'media') ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">
        Como está a segurança da {tenant?.trade_name || tenant?.name || 'sua empresa'} hoje?
      </h1>

      {status && summary && (
        <div className={`mt-4 flex items-center justify-between rounded-md border px-4 py-3 text-sm ${status.className}`}>
          <span className="font-semibold">
            {status.emoji} {status.label}
          </span>
          <span className="text-xs opacity-80">Atualizado às {formatUpdatedAt(summary.updated_at)}</span>
        </div>
      )}

      {summary && (
        <>
          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Central de SST</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <IndicatorCard
              emoji="🔴"
              label="Pendências"
              count={summary.resumo.pendencias}
              className="border-red-200 bg-red-50 text-red-900"
              expanded={expandedCard === 'pendencias'}
              onToggle={() => setExpandedCard(expandedCard === 'pendencias' ? null : 'pendencias')}
              items={pendenciasItems}
            />
            <IndicatorCard
              emoji="🟡"
              label="Próximos vencimentos"
              count={summary.resumo.avisos}
              className="border-amber-200 bg-amber-50 text-amber-900"
              expanded={expandedCard === 'avisos'}
              onToggle={() => setExpandedCard(expandedCard === 'avisos' ? null : 'avisos')}
              items={avisosItems}
            />
            <IndicatorCard
              emoji="🟢"
              label="Ações concluídas"
              count={summary.resumo.acoes_concluidas}
              className="border-green-200 bg-green-50 text-green-900"
              expanded={false}
              onToggle={() => {}}
              items={[]}
            />
            <IndicatorCard
              emoji="📋"
              label="Inspeções pendentes"
              count={summary.resumo.inspecoes_pendentes}
              className="border-brand-100 bg-brand-50 text-brand-900"
              expanded={false}
              onToggle={() => router.push('/empresa/inspecoes')}
              items={[]}
            />
          </div>

          {summary.atencao.length > 0 && (
            <>
              <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">
                ⚠️ Sua atenção hoje
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {summary.atencao.map((item, i) => (
                  <AttentionRow key={i} item={item} />
                ))}
              </div>
            </>
          )}

          {summary.proximos_eventos.length > 0 && (
            <>
              <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">
                📅 Próximos eventos (7 dias)
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {summary.proximos_eventos.map((item, i) => (
                  <AttentionRow key={i} item={item} />
                ))}
              </div>
            </>
          )}

          {summary.atencao.length === 0 && (
            <p className="mt-8 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
              Nenhuma pendência no momento. Sua empresa está em dia.
            </p>
          )}
        </>
      )}

      <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-brand-700">Acesso rápido</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/empresa/documentos" className="rounded-lg border border-brand-100 p-6 transition-colors hover:border-brand-500">
          <h3 className="text-lg font-bold text-brand-900">Documentos</h3>
          <p className="mt-1 text-sm text-brand-700">PGR, PCMSO, laudos, fichas de EPI e treinamentos.</p>
        </Link>
        <Link href="/empresa/epis" className="rounded-lg border border-brand-100 p-6 transition-colors hover:border-brand-500">
          <h3 className="text-lg font-bold text-brand-900">EPIs</h3>
          <p className="mt-1 text-sm text-brand-700">Equipamentos de proteção entregues aos funcionários.</p>
        </Link>
        <Link href="/empresa/inspecoes" className="rounded-lg border border-brand-100 p-6 transition-colors hover:border-brand-500">
          <h3 className="text-lg font-bold text-brand-900">Inspeções</h3>
          <p className="mt-1 text-sm text-brand-700">Visitas técnicas e planos de ação.</p>
        </Link>
        <Link href="/empresa/onboarding" className="rounded-lg border border-brand-100 p-6 transition-colors hover:border-brand-500">
          <h3 className="text-lg font-bold text-brand-900">Dados da empresa</h3>
          <p className="mt-1 text-sm text-brand-700">Matriz, filiais e funcionários.</p>
        </Link>
      </div>
    </div>
  );
}
