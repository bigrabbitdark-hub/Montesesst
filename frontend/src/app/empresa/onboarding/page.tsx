'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DadosEmpresaForm, TenantData } from './DadosEmpresaForm';
import { FiliaisForm, CompanyUnit } from './FiliaisForm';
import { FuncionariosForm } from './FuncionariosForm';

export default function OnboardingPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [hasEmployees, setHasEmployees] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [tenantRes, unitsRes, employeesRes] = await Promise.all([
      fetch('/api/tenants/me', { headers }),
      fetch('/api/company-units', { headers }),
      fetch('/api/employees', { headers }),
    ]);
    if (tenantRes.ok) setTenant(await tenantRes.json());
    if (unitsRes.ok) setUnits(await unitsRes.json());
    if (employeesRes.ok) {
      const employees = await employeesRes.json();
      setHasEmployees(Array.isArray(employees) && employees.length > 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isComplete = !!tenant?.sector && units.length > 0 && hasEmployees;

  if (isComplete) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Cadastro em dia</h1>
        <p className="mt-4 text-brand-700">
          Seus dados estão completos. O Dashboard da empresa está sendo construído — em breve
          você vai poder acompanhar tudo por aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Complete o cadastro da sua empresa</h1>
      <p className="mt-2 text-brand-700">
        Você pode preencher em qualquer ordem, e voltar quando quiser — nada aqui é obrigatório
        agora.
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {tenant && <DadosEmpresaForm tenant={tenant} onSaved={loadAll} />}
        <FiliaisForm units={units} onChanged={loadAll} />
        <FuncionariosForm units={units} onChanged={loadAll} />
      </div>
    </div>
  );
}
