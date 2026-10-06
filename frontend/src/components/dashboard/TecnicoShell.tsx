'use client';

import { useEffect, useState } from 'react';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFooter } from '@/components/DashboardFooter';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import { TECNICO_MENU_ITEMS } from '@/lib/dashboard/menu-tecnico';
import { getUser } from '@/lib/auth';

// Casca da área do técnico/parceiro (mesmo DS v2 da empresa). A sessão não guarda o nome, então o header
// mostra o papel; o botão IA SST fica de fora porque o assistente da empresa é barrado para estes papéis.
export function TecnicoShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [rotulo, setRotulo] = useState('Técnico');

  useEffect(() => {
    setRotulo(getUser()?.role === 'parceiro' ? 'Parceiro' : 'Técnico');
  }, []);

  return (
    <div className="flex min-h-screen bg-dash-page font-[family-name:var(--font-body)]">
      <DashboardSidebar
        open={menuAberto}
        onClose={() => setMenuAberto(false)}
        items={TECNICO_MENU_ITEMS}
        extraItems={[]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          nomeUsuario={rotulo}
          papel="Montese SST"
          iaHref={null}
          comBuscaENotificacoes={false}
          menuAberto={menuAberto}
          onMenuClick={() => setMenuAberto((v) => !v)}
        />
        <main className="flex-1 overflow-x-auto">
          <SubscriptionNotice />
          {children}
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
