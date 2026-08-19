'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PlanosPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('montese_token'));
    fetch('/api/plans?audience=empresa')
      .then((res) => res.json())
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  async function handleSubscribe(planId: string) {
    setError(null);
    setSubscribingPlanId(planId);
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Não foi possível iniciar a assinatura.');
        setSubscribingPlanId(null);
        return;
      }
      const data = await res.json();
      window.location.href = data.initPoint;
    } catch {
      setError('Não foi possível conectar ao servidor.');
      setSubscribingPlanId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold text-brand-900">Planos</h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-brand-700">
        Cada empresa começa com um período de teste (trial) sem custo. Assine quando fizer
        sentido pro seu time.
      </p>

      {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-semibold text-brand-900">{plan.name}</h2>
            <p className="mt-2 text-2xl font-bold text-brand-700">
              {formatPrice(plan.price_cents)}
              <span className="text-sm font-normal text-brand-700">/mês</span>
            </p>
            {plan.employee_limit && (
              <p className="mt-1 text-sm text-brand-700">Até {plan.employee_limit} funcionários</p>
            )}
            {loggedIn ? (
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={subscribingPlanId === plan.id}
                className="mt-6 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {subscribingPlanId === plan.id ? 'Redirecionando...' : 'Assinar'}
              </button>
            ) : (
              <Link
                href="/login"
                className="mt-6 rounded-md border border-brand-500 px-4 py-2 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                Entrar para assinar
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-10 flex justify-center gap-4">
        <Link
          href="/cadastro"
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Ainda não é cliente? Comece grátis
        </Link>
        <Link
          href="/contato"
          className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
        >
          Fale com vendas
        </Link>
      </div>
    </div>
  );
}
