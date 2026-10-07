'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
import { httpStatusTone, subscriptionTone } from '@/components/admin/status-tone';

interface TenantLink {
  id: string;
  name: string;
}

interface TenantDetailTenant {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  technicians: TenantLink[];
  partners: TenantLink[];
}

interface TenantDetailDocument {
  id: string;
  category: string;
  title: string;
  expires_at: string | null;
  created_at: string;
}

interface TenantDetailEpi {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  category: string;
  code: string;
  description: string;
}

interface TenantDetailInspection {
  id: string;
  status: string;
  visited_at: string;
  concluded_at: string | null;
}

interface TenantDetailSubscription {
  id: string;
  status: string;
  created_at: string;
  plan_name: string;
  price_cents: number;
}

interface TenantDetail {
  tenant: TenantDetailTenant;
  documents: TenantDetailDocument[];
  epis: TenantDetailEpi[];
  inspections: TenantDetailInspection[];
  subscriptions: TenantDetailSubscription[];
}

interface PaymentEventRow {
  id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
}

interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_full_name: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  status_code: number;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export default function AdminEmpresaDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const tenantId = params.id;

  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const [statusUpdateState, setStatusUpdateState] = useState<
    Record<string, 'idle' | 'loading' | 'erro'>
  >({});
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);
  const [paymentEventsBySubscription, setPaymentEventsBySubscription] = useState<
    Record<string, PaymentEventRow[]>
  >({});

  async function loadDetail() {
    const token = localStorage.getItem('montese_token');
    try {
      const [detailRes, auditRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/detail`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/audit-log?tenant_id=${tenantId}&limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!detailRes.ok) {
        setLoadError(
          detailRes.status === 404 ? 'Empresa não encontrada.' : 'Não foi possível carregar a empresa.',
        );
        return;
      }
      setDetail(await detailRes.json());
      if (auditRes.ok) setAuditLog(await auditRes.json());
      setLoadError('');
    } catch {
      setLoadError('Não foi possível conectar ao servidor.');
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tenantId]);

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
        const updated: { id: string; status: string; plan_name: string; price_cents: number; created_at: string } =
          await res.json();
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                subscriptions: prev.subscriptions.map((sub) => (sub.id === subscriptionId ? { ...sub, ...updated } : sub)),
              }
            : prev,
        );
        setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'idle' }));
        setConfirmingCancelId(null);
        return;
      }
      setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'erro' }));
    } catch {
      setStatusUpdateState((prev) => ({ ...prev, [subscriptionId]: 'erro' }));
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
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <Link href="/admin/empresas" className="adm-link text-sm">
        ← Voltar para empresas
      </Link>

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      {detail && (
        <>
          <div className="mt-6">
            <AdminPageHeader title={detail.tenant.name} />
          </div>
          <section className="adm-card mt-4 p-5 sm:p-6">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2 sm:gap-y-2">
              <dt className="text-brand-700">CNPJ</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">{detail.tenant.cnpj}</dd>
              <dt className="text-brand-700">Plano</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">{detail.tenant.plan}</dd>
              <dt className="text-brand-700">Status</dt>
              <dd className="mb-2 min-w-0 break-words sm:mb-0">
                <Badge tone="neutral">{detail.tenant.status}</Badge>
              </dd>
              <dt className="text-brand-700">Setor</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">{detail.tenant.sector ?? '—'}</dd>
              <dt className="text-brand-700">Contato</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">
                {detail.tenant.contact_name ?? '—'} {detail.tenant.contact_phone ? `— ${detail.tenant.contact_phone}` : ''}
              </dd>
              <dt className="text-brand-700">Técnicos vinculados</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">
                {detail.tenant.technicians.length === 0
                  ? '—'
                  : detail.tenant.technicians.map((t) => t.name).join(', ')}
              </dd>
              <dt className="text-brand-700">Parceiros vinculados</dt>
              <dd className="mb-2 min-w-0 break-words text-brand-900 sm:mb-0">
                {detail.tenant.partners.length === 0 ? '—' : detail.tenant.partners.map((p) => p.name).join(', ')}
              </dd>
            </dl>
          </section>

          <Card title="Assinaturas" className="mt-8">
            {detail.subscriptions.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhuma assinatura ainda.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {detail.subscriptions.map((sub) => (
                  <li key={sub.id} className="adm-card-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 break-words">
                        <span className="font-medium text-brand-900">{sub.plan_name}</span>
                        <span className="ml-2 text-brand-700">{formatCents(sub.price_cents)}</span>
                        <span className="ml-2">
                          <Badge tone={subscriptionTone(sub.status)}>{sub.status}</Badge>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {sub.status === 'authorized' && (
                          <button
                            onClick={() => handleUpdateStatus(sub.id, 'paused')}
                            disabled={statusUpdateState[sub.id] === 'loading'}
                            className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50"
                          >
                            Pausar
                          </button>
                        )}
                        {sub.status === 'paused' && (
                          <button
                            onClick={() => handleUpdateStatus(sub.id, 'authorized')}
                            disabled={statusUpdateState[sub.id] === 'loading'}
                            className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50"
                          >
                            Reativar
                          </button>
                        )}
                        {(sub.status === 'authorized' || sub.status === 'paused') &&
                          confirmingCancelId !== sub.id && (
                            <button
                              onClick={() => setConfirmingCancelId(sub.id)}
                              disabled={statusUpdateState[sub.id] === 'loading'}
                              className="adm-link-danger shrink-0 whitespace-nowrap disabled:opacity-50"
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
                              className="adm-link-danger shrink-0 whitespace-nowrap disabled:opacity-50"
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
                        <button onClick={() => toggleHistory(sub.id)} className="adm-link shrink-0 whitespace-nowrap">
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

          <Card title="Documentos" className="mt-8">
            {detail.documents.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum documento ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Título</th>
                      <th>Vencimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="text-brand-700">{doc.category}</td>
                        <td className="text-brand-900">{doc.title}</td>
                        <td className="text-brand-700">{formatDate(doc.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="EPIs" className="mt-8">
            {detail.epis.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum EPI cadastrado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Equipamento</th>
                      <th>CA</th>
                      <th>Validade do CA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.epis.map((epi) => (
                      <tr key={epi.id}>
                        <td className="text-brand-700">{epi.category}</td>
                        <td className="text-brand-900">{epi.description}</td>
                        <td className="text-brand-700">{epi.ca_number}</td>
                        <td className="text-brand-700">{formatDate(epi.ca_valid_until)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Inspeções" className="mt-8">
            {detail.inspections.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhuma inspeção ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Visita</th>
                      <th>Status</th>
                      <th>Concluída em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.inspections.map((inspection) => (
                      <tr key={inspection.id}>
                        <td className="text-brand-700">{formatDate(inspection.visited_at)}</td>
                        <td>
                          <Badge tone="neutral">{inspection.status}</Badge>
                        </td>
                        <td className="text-brand-700">
                          {inspection.concluded_at ? formatDateTime(inspection.concluded_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Auditoria (últimos 20 eventos)" className="mt-8">
            {auditLog.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum evento de auditoria encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Quem</th>
                      <th>Ação</th>
                      <th>Recurso</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((row) => (
                      <tr key={row.id}>
                        <td className="text-brand-700">{formatDateTime(row.occurred_at)}</td>
                        <td className="text-brand-700">
                          {row.actor_full_name ?? '—'} {row.actor_role ? `(${row.actor_role})` : ''}
                        </td>
                        <td className="text-brand-900">{row.action}</td>
                        <td className="text-brand-700">{row.resource_type}</td>
                        <td>
                          <Badge tone={httpStatusTone(row.status_code)}>{row.status_code}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
