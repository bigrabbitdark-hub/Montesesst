'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssistantChat } from '@/components/AssistantChat';
import { AssistantSummaryPanel } from '@/components/AssistantSummaryPanel';
import { PenteFinoPanel } from '@/components/PenteFinoPanel';
import { Card } from '@/components/ui/Card';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EmpresaAssistentePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div role="status" className="px-4 py-16 text-center text-sm text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        titulo="Assistente Montese SST"
        descricao="Pergunte sobre normas de SST — o Assistente responde só com o que encontra nas fontes consultadas e avisa quando não encontra fundamento."
      />
      <DashSkin>
        <Card>
          <AssistantSummaryPanel />
          <section className="mt-8 border-y border-brand-100 py-6" aria-label="Auditoria Montese">
            <PenteFinoPanel presentation="assistant" />
          </section>
          <AssistantChat />
        </Card>
      </DashSkin>
    </div>
  );
}
