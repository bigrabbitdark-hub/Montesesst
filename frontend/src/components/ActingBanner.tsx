'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getActing, stopActing, type ActingInfo } from '@/lib/acting';

// Para onde ir depois de sair do modo: ficha da empresa; sem tenant, a lista; se a sessão guardada da sócia
// também tinha vencido (stopActing limpou tudo — Ruling 22), o login.
function destinoAoSair(id: string | null, sufixo = ''): string {
  if (id) return `/atuacao/clientes/${id}${sufixo}`;
  return localStorage.getItem('montese_token') ? '/atuacao/clientes' : '/login';
}

// Faixa fixa do modo "atuar como empresa". Ao vencer o token (30 min), volta sozinha para a ficha da empresa.
export function ActingBanner() {
  const router = useRouter();
  const [info, setInfo] = useState<ActingInfo | null>(null);

  useEffect(() => { setInfo(getActing()); }, []);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => {
      router.replace(destinoAoSair(stopActing(), '?atuacao=expirada'));
    }, Math.max(info.expiresAt - Date.now(), 0));
    return () => clearTimeout(t);
  }, [info, router]);

  if (!info) return null;
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>Você está atuando em <strong>{info.tenantName}</strong>. As ações ficam registradas em seu nome.</span>
      <button
        type="button"
        onClick={() => router.replace(destinoAoSair(stopActing()))}
        className="rounded-md border border-amber-700 bg-white px-3 py-1 font-semibold text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
      >
        Sair do modo empresa
      </button>
    </div>
  );
}
