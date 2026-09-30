'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';

interface AttentionItem {
  tipo: string;
  titulo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  data: string | null;
  responsavel: string;
  link: string;
}

interface DashboardSummary {
  status: 'ok' | 'atencao' | 'critico';
  resumo: {
    pendencias: number;
    avisos: number;
  };
  atencao: AttentionItem[];
}

const PRIORITY_CLASSES: Record<AttentionItem['prioridade'], string> = {
  alta: 'text-red-600',
  media: 'text-amber-700',
  baixa: 'text-brand-700',
};

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export function AssistantSummaryPanel({ tenantId }: { tenantId?: string }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    // Achado real (2026-09-29): sem AbortController, trocar de tenantId
    // rápido (ex.: técnico navegando entre empresas) podia deixar uma
    // resposta ATRASADA da requisição antiga sobrescrever `summary` com o
    // resumo do tenant errado, depois que a requisição nova (mais rápida)
    // já tinha atualizado a tela corretamente — mesma classe de corrida
    // que o AssistantChat.tsx vizinho já evita com AbortController.
    const controller = new AbortController();
    const url = tenantId ? `/api/dashboard/summary?tenant_id=${tenantId}` : '/api/dashboard/summary';
    fetch(url, { headers: authHeaders(), signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSummary)
      // Painel é só um complemento informativo — se a busca falhar (rede,
      // 403 pra um caso não previsto, ou o abort abaixo), o formulário de
      // pergunta continua funcionando normalmente sem o resumo.
      .catch(() => {});
    return () => controller.abort();
  }, [tenantId]);

  if (!summary) return null;

  if (summary.atencao.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-700">✓ Tudo em dia — nenhuma pendência no momento.</p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-brand-100 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-brand-700">
        {summary.resumo.pendencias} pendência(s), {summary.resumo.avisos} aviso(s)
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {summary.atencao.map((item, i) => (
          <li key={i} className="text-sm">
            <Link href={item.link} className={`hover:underline ${PRIORITY_CLASSES[item.prioridade]}`}>
              {item.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
