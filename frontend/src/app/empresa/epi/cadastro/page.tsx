'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EpiCadastroView } from '@/components/epi/EpiCadastroView';

export default function EmpresaEpiCadastroPage() {
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
    return <div role="status" className="px-4 py-16 text-center text-sm text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader titulo="Cadastro de EPI" descricao="Equipamentos da empresa: CA, estoque mínimo e máximo, custo e lotes." />
      <DashSkin>
        <EpiCadastroView />
      </DashSkin>
    </div>
  );
}
