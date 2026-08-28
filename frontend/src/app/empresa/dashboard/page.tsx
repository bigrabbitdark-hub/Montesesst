'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TenantData {
  name: string;
  trade_name: string | null;
}

interface ComplianceResult {
  score: number | null;
  pendencias: { id: string }[];
  avisos: { id: string }[];
}

function DashboardCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-brand-100 p-6 transition-colors hover:border-brand-500"
    >
      <h3 className="text-lg font-bold text-brand-900">{title}</h3>
      <p className="mt-1 text-sm text-brand-700">{description}</p>
    </Link>
  );
}

export default function EmpresaDashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    const headers = { Authorization: `Bearer ${token}` };
    fetch('/api/tenants/me', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then(setTenant)
      .catch(() => {});
    fetch('/api/documents/compliance', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then(setCompliance)
      .catch(() => {});
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">
        {tenant?.trade_name || tenant?.name || 'Sua empresa'}
      </h1>
      <p className="mt-2 text-brand-700">O que você quer ver hoje?</p>

      {compliance && compliance.score !== null && (
        <p className="mt-4 rounded-md bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Score de conformidade: <strong>{compliance.score}%</strong>
          {compliance.pendencias.length > 0 && (
            <> — {compliance.pendencias.length} documento(s) vencido(s)</>
          )}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DashboardCard
          href="/empresa/documentos"
          title="Documentos"
          description="PGR, PCMSO, laudos, fichas de EPI e treinamentos."
        />
        <DashboardCard
          href="/empresa/epis"
          title="EPIs"
          description="Equipamentos de proteção entregues aos funcionários."
        />
        <DashboardCard
          href="/empresa/inspecoes"
          title="Inspeções"
          description="Visitas técnicas e planos de ação."
        />
        <DashboardCard
          href="/empresa/onboarding"
          title="Dados da empresa"
          description="Matriz, filiais e funcionários."
        />
      </div>
    </div>
  );
}
