'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardError, CardSkeleton } from '@/components/admin/Card';
import { AdminIcon } from '@/components/admin/icons';
import { ProviderCard } from '@/components/admin/ia/ProviderCard';
import type { AiProviderView } from '@/lib/admin/ai-config';
import { listProviders } from '@/lib/admin/ai-config';

// /admin/ia — painel de configuração dos 3 provedores de IA
// (MiniMax, OpenRouter, Groq). As chaves vão cifradas com pgcrypto
// (chave mestra AI_CONFIG_ENCRYPTION_KEY) e os consumers resolvem via
// AiConfigService.getResolved() em runtime, sem precisar de deploy.

interface ViewState {
  data: AiProviderView[] | null;
  error: string | null;
  loading: boolean;
}

export default function AdminIaPage() {
  const [view, setView] = useState<ViewState>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Recarrega sempre que tick muda. tick=0 na primeira carga.
  useEffect(() => {
    let cancelled = false;
    setView((v) => ({ ...v, loading: true, error: null }));
    listProviders()
      .then((data) => {
        if (cancelled) return;
        setView({ data, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setView({ data: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-900">IA</h2>
          <p className="mt-1 text-sm text-brand-700">
            Configuração dos provedores de IA. A chave fica cifrada em repouso (pgcrypto) e os serviços
            resolvem a config em runtime — trocar de modelo não exige deploy.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-100 px-3 py-1.5 text-xs font-medium text-brand-900 hover:bg-brand-50"
        >
          <AdminIcon name="refresh" className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {view.loading && !view.data && (
          <>
            <CardSkeleton rows={4} />
            <CardSkeleton rows={4} />
            <CardSkeleton rows={4} />
          </>
        )}
        {view.error && (
          <Card id="ia-erro" title="Não foi possível carregar" className="lg:col-span-3">
            <CardError onRetry={reload} message={view.error} />
          </Card>
        )}
        {view.data?.map((p) => (
          <ProviderCard key={p.provider} view={p} onSaved={reload} />
        ))}
      </div>

      <Card id="ia-avisos" title="Avisos" className="mt-4">
        <ul className="ml-4 list-disc space-y-1 text-xs text-brand-700">
          <li>Variável <code>AI_CONFIG_ENCRYPTION_KEY</code> precisa estar no backend (gere com <code>openssl rand -hex 32</code>). Trocá-la invalida todas as chaves salvas.</li>
          <li>Sem config no painel, o sistema cai na env var e depois no default embutido — útil pra deploy novo, mas o painel é a fonte canônica.</li>
          <li>A chave NUNCA é logada: o <code>AuditInterceptor</code> registra o evento sem o campo, e a UI mostra só o formato mascarado (<code>sk-…XYZW</code>).</li>
        </ul>
      </Card>
    </div>
  );
}
