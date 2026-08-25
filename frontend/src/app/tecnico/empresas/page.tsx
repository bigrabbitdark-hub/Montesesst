'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

interface PortfolioComplianceItem {
  tenant_id: string;
  tenant_name: string;
  score: number | null;
  pendencias_count: number;
  avisos_count: number;
}

export default function TecnicoEmpresasPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<LinkedTenant[]>([]);
  const [compliance, setCompliance] = useState<Record<string, PortfolioComplianceItem>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetch('/api/tenant-technicians/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setTenants(data);
        setLoading(false);
      });
    fetch('/api/documents/compliance/portfolio', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: PortfolioComplianceItem[]) => {
        setCompliance(Object.fromEntries(data.map((item) => [item.tenant_id, item])));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">Suas empresas</h1>
        <Link href="/tecnico/agenda" className="text-sm font-medium text-brand-500 hover:underline">
          Ver agenda completa
        </Link>
      </div>
      {tenants.length === 0 ? (
        <p className="mt-4 text-brand-700">
          Você ainda não está vinculado a nenhuma empresa. Fale com a Montese.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {tenants.map((tenant) => {
            const item = compliance[tenant.tenant_id];
            return (
              <li key={tenant.tenant_id}>
                <Link
                  href={`/tecnico/empresas/${tenant.tenant_id}`}
                  className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-brand-900 hover:bg-brand-100"
                >
                  <span>{tenant.tenant_name}</span>
                  {item && (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-brand-900">
                        {item.score === null ? 'Sem dados' : `${item.score}%`}
                      </span>
                      {item.pendencias_count > 0 && (
                        <span className="text-red-600">{item.pendencias_count} pendência(s)</span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
