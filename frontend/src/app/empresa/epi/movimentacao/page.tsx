'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EpiMovimentacaoView } from '@/components/epi/EpiMovimentacaoView';

export default function EmpresaEpiMovimentacaoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div role="status" className="px-4 py-16 text-center text-base text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader titulo="Movimentação de EPI" descricao="Entradas, entregas, devoluções, trocas, baixas e ajustes de estoque, com a assinatura do funcionário." />
      <DashSkin>
        <EpiMovimentacaoView />
      </DashSkin>
    </div>
  );
}
