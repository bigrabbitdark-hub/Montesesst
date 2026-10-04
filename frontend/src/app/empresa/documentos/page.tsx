'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { Card } from '@/components/ui/Card';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EmpresaDocumentosPage() {
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader titulo="Documentos" descricao="PGR, PCMSO, laudos, fichas de EPI e treinamentos da sua empresa." />
      <DashSkin>
        <Card>
          <DocumentsPanel />
        </Card>
      </DashSkin>
    </div>
  );
}
