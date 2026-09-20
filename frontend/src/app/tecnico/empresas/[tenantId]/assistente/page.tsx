'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AssistantChat } from '@/components/AssistantChat';
import { AssistantSummaryPanel } from '@/components/AssistantSummaryPanel';

export default function TecnicoEmpresaAssistentePage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Assistente Montese SST</h1>
      <p className="mt-2 text-brand-700">Pergunte sobre normas de SST — o Assistente responde só com o que encontra nas fontes consultadas e avisa quando não encontra fundamento.</p>
      <div className="mt-8">
        <AssistantSummaryPanel tenantId={params.tenantId} />
        <AssistantChat tenantId={params.tenantId} />
      </div>
    </div>
  );
}
