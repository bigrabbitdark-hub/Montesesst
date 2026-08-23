'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DocumentsPanel } from '@/components/DocumentsPanel';

export default function TecnicoEmpresaDocumentosPage() {
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
      <h1 className="text-2xl font-bold text-brand-900">Documentos da empresa</h1>
      <div className="mt-8">
        <DocumentsPanel tenantId={params.tenantId} />
      </div>
    </div>
  );
}
