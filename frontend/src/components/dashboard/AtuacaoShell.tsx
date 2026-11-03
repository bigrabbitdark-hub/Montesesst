'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFooter } from '@/components/DashboardFooter';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';
import { atuacaoFetch } from '@/app/atuacao/api';

// Casca do Painel de Atuação dos sócios (mesmo DS v2). A sessão não guarda o nome, então o header
// mostra o papel; sem IA SST, busca ou notificações da empresa.
export function AtuacaoShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const pathname = usePathname();
  // Contador do sino: falha em silêncio (sem permissão alertas.read ou sem rede) e recarrega a cada navegação.
  useEffect(() => {
    let vivo = true;
    atuacaoFetch<{ nao_lidas: number }>('/notificacoes/resumo')
      .then((r) => { if (vivo) setNaoLidas(Number(r?.nao_lidas) || 0); })
      .catch(() => { if (vivo) setNaoLidas(0); });
    return () => { vivo = false; };
  }, [pathname]);
  return (
    <div className="flex min-h-screen bg-dash-page font-[family-name:var(--font-body)]">
      <DashboardSidebar
        open={menuAberto}
        onClose={() => setMenuAberto(false)}
        items={ATUACAO_MENU_ITEMS}
        extraItems={[]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          nomeUsuario="Sócio"
          papel="Montese SST"
          iaHref={null}
          comBuscaENotificacoes={false}
          notificacoesHref="/atuacao/notificacoes"
          notificacoesNaoLidas={naoLidas}
          menuAberto={menuAberto}
          onMenuClick={() => setMenuAberto((v) => !v)}
        />
        <main className="flex-1 overflow-x-auto">
          {children}
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
