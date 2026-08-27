'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface Plan {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
  created_at: string;
  plan_name: string;
  price_cents: number;
  tenant_name: string | null;
  technician_name: string | null;
}

interface PaymentEventRow {
  id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export default function AdminFinanceiroPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [listError, setListError] = useState('');

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPriceReais, setEditPriceReais] = useState('');
  const [editStatus, setEditStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);
  const [paymentEventsBySubscription, setPaymentEventsBySubscription] = useState<
    Record<string, PaymentEventRow[]>
  >({});

  async function loadPlans() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/plans', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setPlans(await res.json());
    } catch {
      // lista de planos fica vazia; erro de conexão já reportado por loadSubscriptions
    }
  }

  async function loadSubscriptions() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setSubscriptions(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar as assinaturas.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadPlans(), loadSubscriptions()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleEditPrice(event: FormEvent, planId: string) {
    event.preventDefault();
    setEditStatus('loading');
    const reaisValue = Number.parseFloat(editPriceReais.replace(',', '.'));
    if (Number.isNaN(reaisValue) || reaisValue < 0) {
      setEditStatus('erro');
      return;
    }
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price_cents: Math.round(reaisValue * 100) }),
      });
      if (res.ok) {
        setEditingPlanId(null);
        setEditPriceReais('');
        setEditStatus('idle');
        loadPlans();
        return;
      }
      setEditStatus('erro');
    } catch {
      setEditStatus('erro');
    }
  }

  async function toggleHistory(subscriptionId: string) {
    if (expandedSubscriptionId === subscriptionId) {
      setExpandedSubscriptionId(null);
      return;
    }
    setExpandedSubscriptionId(subscriptionId);
    if (paymentEventsBySubscription[subscriptionId]) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/payment-events`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const events: PaymentEventRow[] = await res.json();
        setPaymentEventsBySubscription((prev) => ({ ...prev, [subscriptionId]: events }));
      }
    } catch {
      // histórico fica vazio pra essa assinatura; sem estado de erro dedicado
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Planos</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-100 text-brand-700">
              <th className="py-2">Plano</th>
              <th className="py-2">Público</th>
              <th className="py-2">Preço</th>
              <th className="py-2">Limite de funcionários</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-b border-brand-100">
                <td className="py-2 font-medium text-brand-900">{plan.name}</td>
                <td className="py-2 text-brand-700">{plan.audience}</td>
                <td className="py-2 text-brand-700">
                  {editingPlanId === plan.id ? (
                    <form onSubmit={(e) => handleEditPrice(e, plan.id)} className="flex items-center gap-2">
                      <input
                        required
                        value={editPriceReais}
                        onChange={(e) => setEditPriceReais(e.target.value)}
                        placeholder="0,00"
                        className="w-24 rounded-md border border-brand-100 px-2 py-1"
                      />
                      <button type="submit" className="text-brand-500 hover:underline">
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPlanId(null)}
                        className="text-brand-700 hover:underline"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    formatCents(plan.price_cents)
                  )}
                </td>
                <td className="py-2 text-brand-700">{plan.employee_limit ?? '—'}</td>
                <td className="py-2">
                  {editingPlanId !== plan.id && (
                    <button
                      onClick={() => {
                        setEditingPlanId(plan.id);
                        setEditPriceReais((plan.price_cents / 100).toFixed(2).replace('.', ','));
                        setEditStatus('idle');
                      }}
                      className="text-brand-500 hover:underline"
                    >
                      Editar preço
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editStatus === 'erro' && <p className="mt-2 text-sm text-red-600">Não foi possível salvar o preço.</p>}
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Assinaturas</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {subscriptions.length === 0 && !listError ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma assinatura ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">{sub.tenant_name ?? sub.technician_name ?? '—'}</strong>
                    <span className="ml-2 text-brand-700">{sub.plan_name}</span>
                    <span className="ml-2 text-brand-700">({sub.status})</span>
                  </div>
                  <button onClick={() => toggleHistory(sub.id)} className="text-brand-500 hover:underline">
                    {expandedSubscriptionId === sub.id ? 'Ocultar histórico' : 'Ver histórico'}
                  </button>
                </div>

                {expandedSubscriptionId === sub.id && (
                  <div className="mt-3 border-t border-brand-100 pt-3">
                    {(paymentEventsBySubscription[sub.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-brand-700">Nenhuma cobrança registrada ainda.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-xs text-brand-700">
                        {paymentEventsBySubscription[sub.id].map((event) => (
                          <li key={event.id}>
                            {formatDateTime(event.occurred_at)} — {formatCents(event.amount_cents)} —{' '}
                            {event.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
