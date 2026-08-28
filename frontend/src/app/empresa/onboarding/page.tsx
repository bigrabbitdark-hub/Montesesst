'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MatrizForm, TenantData } from './MatrizForm';
import { FiliaisForm, CompanyUnit } from './FiliaisForm';
import { FuncionariosForm } from './FuncionariosForm';
import { DocumentsPanel } from '@/components/DocumentsPanel';

const REQUIRED_MATRIZ_FIELDS: (keyof TenantData)[] = [
  'trade_name',
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'contact_name',
  'contact_role',
];

function isMatrizComplete(tenant: TenantData | null): boolean {
  if (!tenant) return false;
  return REQUIRED_MATRIZ_FIELDS.every((field) => !!tenant[field]);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [skippedInitialRedirect, setSkippedInitialRedirect] = useState(false);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [tenantRes, unitsRes] = await Promise.all([
      fetch('/api/tenants/me', { headers }),
      fetch('/api/company-units', { headers }),
    ]);
    let tenantData: TenantData | null = null;
    let unitsData: CompanyUnit[] = [];
    if (tenantRes.ok) tenantData = await tenantRes.json();
    if (unitsRes.ok) unitsData = await unitsRes.json();
    setTenant(tenantData);
    setUnits(unitsData);
    setLoading(false);

    // Visita de retorno com a matriz já completa: pula o wizard inteiro e
    // vai direto pro dashboard. Só acontece uma vez, no carregamento
    // inicial — depois que o usuário já está navegando pelo wizard nesta
    // sessão (ex: voltou pro passo 1 pra corrigir algo), não interrompe
    // de novo.
    if (!skippedInitialRedirect) {
      setSkippedInitialRedirect(true);
      if (isMatrizComplete(tenantData)) {
        router.replace('/empresa/dashboard');
        return;
      }
    }
    if (isMatrizComplete(tenantData) && step === 1) {
      setStep(2);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !tenant) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const matrizComplete = isMatrizComplete(tenant);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Complete o cadastro da sua empresa</h1>
      <p className="mt-2 text-brand-700">
        O passo 1 (matriz) é obrigatório. Os demais você pode pular e voltar depois.
      </p>

      {step === 1 && <MatrizForm tenant={tenant} onSaved={loadAll} />}

      {step === 2 && (
        <>
          <FiliaisForm units={units} onChanged={loadAll} />
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700"
            >
              Voltar
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Continuar
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <FuncionariosForm units={units} onChanged={loadAll} />
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700"
            >
              Voltar
            </button>
            <button
              onClick={() => setStep(4)}
              className="rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Continuar
            </button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <section className="rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">4. Documentos (opcional)</h2>
            <p className="mt-1 text-sm text-brand-700">
              PGR, PCMSO, laudos, fichas de EPI — pode enviar agora ou depois, a qualquer momento.
            </p>
            <div className="mt-4">
              <DocumentsPanel />
            </div>
          </section>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push('/empresa/dashboard')}
              disabled={!matrizComplete}
              className="rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Finalizar cadastro
            </button>
          </div>
        </>
      )}
    </div>
  );
}
