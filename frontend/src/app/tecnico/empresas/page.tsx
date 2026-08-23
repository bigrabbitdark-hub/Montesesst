'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

export default function TecnicoEmpresasPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<LinkedTenant[]>([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Suas empresas</h1>
      {tenants.length === 0 ? (
        <p className="mt-4 text-brand-700">
          Você ainda não está vinculado a nenhuma empresa. Fale com a Montese.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {tenants.map((tenant) => (
            <li key={tenant.tenant_id}>
              <Link
                href={`/tecnico/empresas/${tenant.tenant_id}`}
                className="block rounded-md border border-brand-100 px-4 py-3 text-brand-900 hover:bg-brand-100"
              >
                {tenant.tenant_name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
