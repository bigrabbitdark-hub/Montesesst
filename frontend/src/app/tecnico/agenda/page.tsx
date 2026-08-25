'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

interface DocumentRow {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  expires_at: string | null;
}

interface AgendaItem {
  id: string;
  tenant_name: string;
  category: string;
  title: string;
  expires_at: string;
}

interface AgendaGroup {
  label: string;
  items: AgendaItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function groupAgendaByMonth(documents: DocumentRow[], tenantNames: Record<string, string>): AgendaGroup[] {
  const items: AgendaItem[] = documents
    .filter((doc): doc is DocumentRow & { expires_at: string } => doc.expires_at !== null)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
    .map((doc) => ({
      id: doc.id,
      tenant_name: tenantNames[doc.tenant_id] ?? 'Empresa',
      category: doc.category,
      title: doc.title,
      expires_at: doc.expires_at,
    }));

  const groups: AgendaGroup[] = [];
  for (const item of items) {
    const label = capitalize(
      new Date(item.expires_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    );
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export default function TecnicoAgendaPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      fetch('/api/tenant-technicians/me', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/documents', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([tenantsRes, documentsRes]) => {
        if (!tenantsRes.ok || !documentsRes.ok) {
          setError('Não foi possível carregar a agenda.');
          setLoading(false);
          return;
        }
        const tenants: LinkedTenant[] = await tenantsRes.json();
        const docs: DocumentRow[] = await documentsRes.json();
        setTenantNames(Object.fromEntries(tenants.map((t) => [t.tenant_id, t.tenant_name])));
        setDocuments(docs);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível conectar ao servidor.');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const agendaGroups = groupAgendaByMonth(documents, tenantNames);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">Agenda da carteira</h1>
        <Link href="/tecnico/empresas" className="text-sm font-medium text-brand-500 hover:underline">
          Ver empresas
        </Link>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {agendaGroups.length === 0 ? (
        <p className="mt-4 text-brand-700">Nenhum vencimento cadastrado nas empresas da sua carteira.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {agendaGroups.map((group) => (
            <div key={group.label}>
              <h2 className="text-sm font-bold text-brand-900">{group.label}</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-brand-700">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium text-brand-900">{item.tenant_name}</span> —{' '}
                    {CATEGORY_LABELS[item.category]} — {item.title} (
                    {new Date(item.expires_at).toLocaleDateString('pt-BR')})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
