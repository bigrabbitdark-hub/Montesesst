'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminNav } from '@/components/AdminNav';

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
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>
      <div className="mt-8">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {tenants.length === 0 && !error ? (
          <p className="text-sm text-brand-700">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-100 text-brand-700">
                <th className="py-2">Empresa</th>
                <th className="py-2">CNPJ</th>
                <th className="py-2">Plano</th>
                <th className="py-2">Status</th>
                <th className="py-2">Técnicos</th>
                <th className="py-2">Parceiros</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-brand-100">
                  <td className="py-2 font-medium text-brand-900">{tenant.name}</td>
                  <td className="py-2 text-brand-700">{tenant.cnpj}</td>
                  <td className="py-2 text-brand-700">{tenant.plan}</td>
                  <td className="py-2 text-brand-700">{tenant.status}</td>
                  <td className="py-2 text-brand-700">
                    {tenant.technicians.length === 0
                      ? '—'
                      : tenant.technicians.map((t) => t.name).join(', ')}
                  </td>
                  <td className="py-2 text-brand-700">
                    {tenant.partners.length === 0
                      ? '—'
                      : tenant.partners.map((p) => p.name).join(', ')}
                  </td>
                  <td className="py-2">
                    <Link href={`/admin/empresas/${tenant.id}`} className="text-brand-500 hover:underline">
                      Ver detalhes
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
