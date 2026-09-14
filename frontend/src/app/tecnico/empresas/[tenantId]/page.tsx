'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { EpisPanel } from '@/components/EpisPanel';

interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export default function TecnicoEmpresaDocumentosPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function loadInspections() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections?tenant_id=${params.tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInspections(await res.json());
      } else {
        setError('Não foi possível carregar as inspeções.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadInspections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleNovaInspecao() {
    setCreating(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: params.tenantId,
          visited_at: new Date().toISOString().slice(0, 10),
        }),
      });
      if (res.ok) {
        const inspection = await res.json();
        router.push(`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`);
        return;
      }
      setError('Não foi possível criar a inspeção.');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setCreating(false);
  }

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Documentos da empresa</h1>
      <div className="mt-8">
        <DocumentsPanel tenantId={params.tenantId} />
      </div>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Assistente</h2>
          <Link
            href={`/tecnico/empresas/${params.tenantId}/assistente`}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Abrir Assistente
          </Link>
        </div>
        <p className="mt-2 text-sm text-brand-700">
          Pergunte sobre normas de SST e veja o resumo de pendências desta empresa.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Pente-Fino</h2>
          <Link
            href={`/tecnico/empresas/${params.tenantId}/pente-fino`}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Abrir Pente-Fino
          </Link>
        </div>
        <p className="mt-2 text-sm text-brand-700">
          Cruza as funções do PGR com os exames do PCMSO desta empresa.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Inspeções</h2>
          <button
            onClick={handleNovaInspecao}
            disabled={creating}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Nova inspeção'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {inspections.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma inspeção registrada ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <Link
                  href={`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`}
                  className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">{formatDate(inspection.visited_at)}</span>
                  <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Catálogo de EPI</h2>
        <div className="mt-4">
          <EpisPanel tenantId={params.tenantId} />
        </div>
      </section>
    </div>
  );
}
