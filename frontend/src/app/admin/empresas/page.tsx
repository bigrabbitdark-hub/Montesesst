'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/Card';

interface TenantLink {
  id: string;
  name: string;
}

interface TenantRow {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  technicians: TenantLink[];
  partners: TenantLink[];
}

export default function AdminEmpresasPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/tenants', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setTenants)
      .catch(() => setError('Não foi possível carregar as empresas.'));
  }, [router]);

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <AdminPageHeader title="Empresas" />
      <div className="mt-6">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {tenants.length === 0 && !error ? (
          <p className="text-sm text-brand-700">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <div className="adm-card overflow-x-auto p-2 sm:p-4">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>CNPJ</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Técnicos</th>
                  <th>Parceiros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="font-medium text-brand-900">{tenant.name}</td>
                    <td className="text-brand-700">{tenant.cnpj}</td>
                    <td className="text-brand-700">{tenant.plan}</td>
                    <td>
                      <Badge tone="neutral">{tenant.status}</Badge>
                    </td>
                    <td className="text-brand-700">
                      {tenant.technicians.length === 0
                        ? '—'
                        : tenant.technicians.map((t) => t.name).join(', ')}
                    </td>
                    <td className="text-brand-700">
                      {tenant.partners.length === 0
                        ? '—'
                        : tenant.partners.map((p) => p.name).join(', ')}
                    </td>
                    <td>
                      <Link href={`/admin/empresas/${tenant.id}`} className="adm-link">
                        Ver detalhes
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
