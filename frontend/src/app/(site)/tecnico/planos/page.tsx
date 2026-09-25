'use client';

import Link from 'next/link';
import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';
import { useEffect, useState } from 'react';
import { MountainDivider } from '@/components/MountainDivider';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PlanosTecnicoPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('montese_token'));
    fetch('/api/plans?audience=tecnico')
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
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-2 pt-16 sm:px-10 sm:pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Plano para técnico</h1>
        <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
          Tenha sua carteira de clientes organizada na plataforma.
        </p>
      </div>

      {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

      <div className="mx-auto mt-10 grid max-w-sm gap-6 pb-16 sm:grid-cols-1">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col items-center rounded-2xl border border-brand-100 bg-white p-7">
            <h2 className="text-[17px] font-bold text-brand-900">{plan.name}</h2>

            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-[32px] font-extrabold text-brand-900">{formatPrice(plan.price_cents)}</span>
              <span className="text-[13px] text-brand-700">/mês</span>
            </div>

            {loggedIn ? (
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={subscribingPlanId === plan.id}
                className="mt-7 rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {subscribingPlanId === plan.id ? 'Redirecionando...' : 'Assinar'}
              </button>
            ) : (
              <Link
                href="/login"
                className="mt-7 rounded-[9px] border-[1.5px] border-brand-500 px-6 py-3.5 text-center text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                Entrar para assinar
              </Link>
            )}
            <PaymentIssuerNote className="mt-4" />
          </div>
        ))}
      </div>

      <p className="mx-auto max-w-2xl pb-16 text-center text-sm text-brand-700">
        Ainda não tem conta de técnico?{' '}
        <Link href="/tecnico/cadastro" className="font-medium text-brand-900 hover:underline">
          Cadastre-se
        </Link>
      </p>

      <MountainDivider />
    </section>
  );
}
