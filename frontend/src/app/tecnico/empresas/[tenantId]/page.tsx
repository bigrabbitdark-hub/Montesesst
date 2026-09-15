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

interface ChecklistRow {
  id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
}

interface CompanyUnitOption {
  id: string;
  tenant_id: string;
  name: string;
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
  const [checklists, setChecklists] = useState<ChecklistRow[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [inspectionUnitId, setInspectionUnitId] = useState('');
  const [inspectionStartedAt, setInspectionStartedAt] = useState('');
  const [inspectionEndedAt, setInspectionEndedAt] = useState('');
  const [checklistUnitId, setChecklistUnitId] = useState('');
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState('');

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

  async function loadChecklists() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/prevention-checklists?tenant_id=${params.tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setChecklists(await res.json());
      } else {
        setChecklistError('Não foi possível carregar os checklists de prevenção.');
      }
    } catch {
      setChecklistError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadUnits() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/company-units', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // RLS devolve as filiais de TODOS os tenants vinculados a este
        // técnico/parceiro (assigned_tenant_ids_for_current_user()), não
        // só desta empresa — filtra no cliente pelo tenant da página atual.
        const all: CompanyUnitOption[] = await res.json();
        setUnits(all.filter((u) => u.tenant_id === params.tenantId));
      }
    } catch {
      // Falha aqui só impede escolher filial pra um checklist novo — não
      // é crítico o bastante pra um erro genérico de página.
    }
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadInspections();
    loadChecklists();
    loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleNovaInspecao() {
    if (!inspectionUnitId) {
      setError('Selecione a filial.');
      return;
    }
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
          company_unit_id: inspectionUnitId,
          started_at: inspectionStartedAt || undefined,
          ended_at: inspectionEndedAt || undefined,
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

  async function handleNovoChecklist() {
    if (!checklistUnitId) {
      setChecklistError('Selecione a filial.');
      return;
    }
    setCreatingChecklist(true);
    setChecklistError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/prevention-checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: params.tenantId,
          company_unit_id: checklistUnitId,
          data_realizacao: new Date().toISOString().slice(0, 10),
        }),
      });
      if (res.ok) {
        const checklist = await res.json();
        router.push(`/tecnico/empresas/${params.tenantId}/checklist-prevencao/${checklist.id}`);
        return;
      }
      setChecklistError('Não foi possível criar o checklist.');
    } catch {
      setChecklistError('Não foi possível conectar ao servidor.');
    }
    setCreatingChecklist(false);
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
        <h2 className="text-lg font-bold text-brand-900">Inspeções</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={inspectionUnitId}
              onChange={(e) => setInspectionUnitId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Início
            <input
              type="time"
              value={inspectionStartedAt}
              onChange={(e) => setInspectionStartedAt(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Término
            <input
              type="time"
              value={inspectionEndedAt}
              onChange={(e) => setInspectionEndedAt(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
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
        <h2 className="text-lg font-bold text-brand-900">Checklist de prevenção</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={checklistUnitId}
              onChange={(e) => setChecklistUnitId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleNovoChecklist}
            disabled={creatingChecklist}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creatingChecklist ? 'Criando...' : 'Novo checklist'}
          </button>
        </div>
        {checklistError && <p className="mt-2 text-sm text-red-600">{checklistError}</p>}
        {checklists.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum checklist de prevenção registrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {checklists.map((checklist) => (
              <li key={checklist.id}>
                <Link
                  href={`/tecnico/empresas/${params.tenantId}/checklist-prevencao/${checklist.id}`}
                  className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">{formatDate(checklist.data_realizacao)}</span>
                  <span className={checklist.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {checklist.status === 'concluida' ? 'Concluída' : 'Rascunho'}
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
