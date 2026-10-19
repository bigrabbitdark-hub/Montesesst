'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EpiFichasView } from '@/components/epi/EpiFichasView';

export default function EmpresaEpiFichasPage() {
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
      <PageHeader titulo="Fichas de EPI" descricao="Ficha de EPI por funcionário: histórico, assinaturas e versões emitidas em PDF." />
      <DashSkin>
        <EpiFichasView />
      </DashSkin>
    </div>
  );
}
