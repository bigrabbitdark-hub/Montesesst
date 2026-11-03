'use client';

import { useState } from 'react';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFooter } from '@/components/DashboardFooter';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

// Casca do Painel de Atuação dos sócios (mesmo DS v2). A sessão não guarda o nome, então o header
// mostra o papel; sem IA SST, busca ou notificações da empresa.
export function AtuacaoShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
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
