'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FuncionariosTable } from '@/components/FuncionariosTable';
import { NovoFuncionarioForm, type UnitOption } from '@/components/NovoFuncionarioForm';
import { Card } from '@/components/ui/Card';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EmpresaFuncionariosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitId, setUnitId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setUnits(Array.isArray(data) ? data : []))
      .catch(() => setUnits([]));
  }, [router]);

  if (!ready) {
    return <div role="status" className="px-4 py-16 text-center text-sm text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        titulo="Funcionários"
        descricao="Tabela oficial dos funcionários da empresa. Edite várias células de uma vez e confirme, ou cadastre um funcionário novo."
      />
      <DashSkin>
        <Card>
          <div className="flex flex-col gap-4">
            <NovoFuncionarioForm units={units} onCreated={() => setRefreshKey((k) => k + 1)} />
            {units.length > 0 && (
              <label className="flex flex-col gap-1 text-xs font-semibold text-dash-muted sm:max-w-xs">
                Filtrar por filial
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="w-full rounded-md border border-dash-border-soft bg-dash-card px-2 py-1.5 text-sm font-normal text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary"
                >
                  <option value="">Todas as filiais</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <FuncionariosTable companyUnitId={unitId || undefined} refreshKey={refreshKey} />
          </div>
        </Card>
      </DashSkin>
    </div>
  );
}
