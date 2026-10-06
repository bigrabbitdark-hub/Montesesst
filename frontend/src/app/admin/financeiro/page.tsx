'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { company } from '@/lib/company';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
import { subscriptionTone } from '@/components/admin/status-tone';

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

  const [statusUpdateState, setStatusUpdateState] = useState<
    Record<string, 'idle' | 'loading' | 'erro'>
  >({});
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);

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

  async function handleUpdateStatus(subscriptionId: string, newStatus: 'authorized' | 'paused' | 'cancelled') {
    setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'loading' }));
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated: SubscriptionRow = await res.json();
        setSubscriptions((prev) => prev.map((sub) => (sub.id === subscriptionId ? updated : sub)));
        setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'idle' }));
        setConfirmingCancelId(null);
        return;
      }
      setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'erro' }));
    } catch {
      setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'erro' }));
    }
  }

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <AdminPageHeader
        title="Financeiro"
        description={`Recebedor: ${company.nomeFantasia} · CNPJ ${company.cnpj}`}
      />

      <Card title="Planos" className="mt-6">
        <div className="overflow-x-auto">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Plano</th>
                <th>Público</th>
                <th>Preço</th>
                <th>Limite de funcionários</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td className="font-medium text-brand-900">{plan.name}</td>
                  <td className="text-brand-700">{plan.audience}</td>
                  <td className="text-brand-700">
                    {editingPlanId === plan.id ? (
                      <form onSubmit={(e) => handleEditPrice(e, plan.id)} className="flex items-center gap-2">
                        <input
                          required
                          value={editPriceReais}
                          onChange={(e) => setEditPriceReais(e.target.value)}
                          placeholder="0,00"
                          className="adm-input w-24"
                        />
                        <button type="submit" className="adm-link">
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
                  <td className="text-brand-700">{plan.employee_limit ?? '—'}</td>
                  <td>
                    {editingPlanId !== plan.id && (
                      <button
                        onClick={() => {
                          setEditingPlanId(plan.id);
                          setEditPriceReais((plan.price_cents / 100).toFixed(2).replace('.', ','));
                          setEditStatus('idle');
                        }}
                        className="adm-link"
                      >
                        Editar preço
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editStatus === 'erro' && <p className="mt-2 text-sm text-red-600">Não foi possível salvar o preço.</p>}
      </Card>

      <Card title="Assinaturas" className="mt-8">
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {subscriptions.length === 0 && !listError ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma assinatura ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="adm-card-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div>
                    <strong className="text-brand-900">{sub.tenant_name ?? sub.technician_name ?? '—'}</strong>
                    <span className="ml-2 text-brand-700">{sub.plan_name}</span>
                    <span className="ml-2">
                      <Badge tone={subscriptionTone(sub.status)}>{sub.status}</Badge>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {sub.status === 'authorized' && (
                      <button
                        onClick={() => handleUpdateStatus(sub.id, 'paused')}
                        disabled={statusUpdateState[sub.id] === 'loading'}
                        className="adm-link disabled:opacity-50"
                      >
                        Pausar
                      </button>
                    )}
                    {sub.status === 'paused' && (
                      <button
                        onClick={() => handleUpdateStatus(sub.id, 'authorized')}
                        disabled={statusUpdateState[sub.id] === 'loading'}
                        className="adm-link disabled:opacity-50"
                      >
                        Reativar
                      </button>
                    )}
                    {(sub.status === 'authorized' || sub.status === 'paused') &&
                      confirmingCancelId !== sub.id && (
                        <button
                          onClick={() => setConfirmingCancelId(sub.id)}
                          disabled={statusUpdateState[sub.id] === 'loading'}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    {confirmingCancelId === sub.id && (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-brand-700">Cancelar de vez?</span>
                        <button
                          onClick={() => handleUpdateStatus(sub.id, 'cancelled')}
                          disabled={statusUpdateState[sub.id] === 'loading'}
                          className="font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Sim, cancelar
                        </button>
                        <button
                          onClick={() => setConfirmingCancelId(null)}
                          className="text-brand-700 hover:underline"
                        >
                          Não
                        </button>
                      </span>
                    )}
                    <button onClick={() => toggleHistory(sub.id)} className="adm-link">
                      {expandedSubscriptionId === sub.id ? 'Ocultar histórico' : 'Ver histórico'}
                    </button>
                  </div>
                </div>

                {statusUpdateState[sub.id] === 'erro' && (
                  <p className="mt-2 text-xs text-red-600">Não foi possível atualizar o status da assinatura.</p>
                )}

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
      </Card>
    </div>
  );
}
