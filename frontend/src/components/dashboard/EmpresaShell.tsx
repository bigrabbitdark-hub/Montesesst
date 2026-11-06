'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFooter } from '@/components/DashboardFooter';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import { IndisponivelAtuando } from '@/components/dashboard/IndisponivelAtuando';
import { getToken } from '@/lib/auth';
import { useAtuando } from '@/lib/useAtuando';
import { HREFS_BLOQUEADOS_ATUANDO, MENU_SETORES, filtrarMenuAtuando, rotaBloqueadaAtuando } from '@/lib/dashboard/menu';

interface TenantBranding {
  id: string;
  name: string;
  trade_name: string | null;
  has_logo: boolean;
}

// Casca única da área da empresa (sidebar + header + aviso de assinatura + rodapé). Usada por
// /empresa/* e /dashboard-v2, para que nenhum item do menu leve de volta ao visual antigo.
export function EmpresaShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [tenant, setTenant] = useState<TenantBranding | null>(null);
  const atuando = useAtuando();
  const pathname = usePathname() ?? '';
  // Áreas bloqueadas só montam depois de confirmar que NÃO é modo atuação (null = ainda lendo): evita um fetch proibido.
  const bloqueada = rotaBloqueadaAtuando(pathname);
  const setores = atuando ? filtrarMenuAtuando(MENU_SETORES, HREFS_BLOQUEADOS_ATUANDO) : undefined;

  // Mesmo gancho da sidebar antiga: o logo enviado em Dados da empresa dispara este evento.
  useEffect(() => {
    function carregar() {
      const token = getToken();
      if (!token) return;
      fetch('/api/tenants/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then(setTenant)
        .catch(() => {});
    }
    carregar();
    window.addEventListener('montese:tenant-updated', carregar);
    return () => window.removeEventListener('montese:tenant-updated', carregar);
  }, []);

  const nome = tenant?.trade_name || tenant?.name || 'Sua empresa';
  return (
    <div className="flex min-h-screen bg-dash-page font-[family-name:var(--font-body)]">
      <DashboardSidebar setores={setores} open={menuAberto} onClose={() => setMenuAberto(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          nomeUsuario={nome.split(' ')[0]}
          papel="Empresa"
          iaHref={atuando ? null : undefined}
          logoSrc={tenant?.has_logo ? `/api/tenants/${tenant.id}/logo` : undefined}
          menuAberto={menuAberto}
          onMenuClick={() => setMenuAberto((v) => !v)}
        />
        <main className="flex-1 overflow-x-auto">
          {atuando === false && <SubscriptionNotice />}
          {bloqueada ? (atuando === true ? <IndisponivelAtuando /> : atuando === false ? children : null) : children}
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
