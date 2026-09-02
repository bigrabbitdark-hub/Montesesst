'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CompanyUnit, CIPA_COMPANY_UNIT_STORAGE_KEY as STORAGE_KEY } from '@/lib/cipa-types';

export default function CipaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CompanyUnit[]) => {
        setUnits(data);
        const stored = sessionStorage.getItem(STORAGE_KEY);
        const initial = stored && data.some((u) => u.id === stored) ? stored : data[0]?.id ?? '';
        setSelectedUnitId(initial);
        if (initial) sessionStorage.setItem(STORAGE_KEY, initial);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  function handleChange(unitId: string) {
    setSelectedUnitId(unitId);
    sessionStorage.setItem(STORAGE_KEY, unitId);
    // Recarrega a página atual pra ela buscar os dados da unidade nova —
    // mais simples que propagar a mudança via Context pra páginas que já
    // fazem fetch próprio no useEffect delas.
    window.location.reload();
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (units.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-brand-700">
          Nenhum estabelecimento cadastrado ainda.{' '}
          <a href="/empresa/onboarding" className="font-semibold text-brand-900 underline">
            Cadastre um em Dados da empresa
          </a>{' '}
          antes de usar a Central da CIPA.
        </p>
      </div>
    );
  }

  return (
    <div>
      {units.length > 1 && (
        <div className="mx-4 mt-8 flex items-center gap-2 text-sm sm:mx-0">
          <label htmlFor="cipa-unit-select" className="font-medium text-brand-700">
            Estabelecimento:
          </label>
          <select
            id="cipa-unit-select"
            value={selectedUnitId}
            onChange={(e) => handleChange(e.target.value)}
            className="rounded-md border border-brand-100 px-2 py-1"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {children}
    </div>
  );
}
