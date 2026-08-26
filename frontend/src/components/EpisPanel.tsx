'use client';

import { FormEvent, useEffect, useState } from 'react';

interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface EpiRow {
  id: string;
  ca_number: string;
  ca_valid_until: string | null;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface Employee {
  id: string;
  full_name: string;
}

interface Delivery {
  id: string;
  employee_id: string;
  delivered_at: string;
  signed_by_name: string;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function EpisPanel({ tenantId }: { tenantId?: string }) {
  const [catalogItems, setCatalogItems] = useState<EpiCatalogItem[]>([]);
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [selectedItemId, setSelectedItemId] = useState('');
  const [caNumber, setCaNumber] = useState('');
  const [caValidUntil, setCaValidUntil] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [deliveriesByEpi, setDeliveriesByEpi] = useState<Record<string, Delivery[]>>({});
  const [deliveryFormEpiId, setDeliveryFormEpiId] = useState<string | null>(null);
  const [deliveryEmployeeId, setDeliveryEmployeeId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliverySignedBy, setDeliverySignedBy] = useState('');

  function episUrl(): string {
    return tenantId ? `/api/epis?tenant_id=${tenantId}` : '/api/epis';
  }

  function employeesUrl(): string {
    return tenantId ? `/api/employees?tenant_id=${tenantId}` : '/api/employees';
  }

  async function loadCatalogItems() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/epi-catalog-items', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const items: EpiCatalogItem[] = await res.json();
        setCatalogItems(items);
        if (items.length > 0) setSelectedItemId(items[0].id);
      }
    } catch {
      // catálogo é dado fixo; falha aqui só deixa o seletor vazio, sem
      // bloquear o resto do painel.
    }
  }

  async function loadEpis() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(episUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setEpis(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os EPIs.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadEmployees() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(employeesUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setEmployees(await res.json());
    } catch {
      // seletor de funcionário fica vazio; erro de conexão já reportado
      // pelo loadEpis, não duplica estado de erro aqui.
    }
  }

  useEffect(() => {
    Promise.all([loadCatalogItems(), loadEpis(), loadEmployees()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/epis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          epi_catalog_item_id: selectedItemId,
          ca_number: caNumber,
          ca_valid_until: caValidUntil || undefined,
          tenant_id: tenantId,
        }),
      });
      if (res.ok) {
        setCaNumber('');
        setCaValidUntil('');
        setStatus('idle');
        loadEpis();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o EPI.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleDelete(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadEpis();
      } else {
        setListError('Não foi possível apagar o EPI.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadDeliveries(epiId: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${epiId}/deliveries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const deliveries: Delivery[] = await res.json();
        setDeliveriesByEpi((prev) => ({ ...prev, [epiId]: deliveries }));
      }
    } catch {
      // lista de entregas fica vazia pra esse EPI; sem estado de erro
      // dedicado, mesmo espírito de loadEmployees.
    }
  }

  async function handleRegisterDelivery(event: FormEvent, epiId: string) {
    event.preventDefault();
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/epis/${epiId}/deliveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employee_id: deliveryEmployeeId,
          delivered_at: deliveryDate,
          signed_by_name: deliverySignedBy,
        }),
      });
      if (res.ok) {
        setDeliveryFormEpiId(null);
        setDeliveryEmployeeId('');
        setDeliveryDate('');
        setDeliverySignedBy('');
        loadDeliveries(epiId);
      } else {
        setListError('Não foi possível registrar a entrega.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  if (loading) {
    return <p className="text-brand-700">Carregando EPIs...</p>;
  }

  const itemsByCategory: Record<string, EpiCatalogItem[]> = {};
  for (const item of catalogItems) {
    if (!itemsByCategory[item.category]) itemsByCategory[item.category] = [];
    itemsByCategory[item.category].push(item);
  }

  function employeeName(id: string): string {
    return employees.find((e) => e.id === id)?.full_name ?? 'Funcionário';
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Cadastrar EPI</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Item do Anexo I (NR-06)
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {Object.entries(itemsByCategory).map(([category, items]) => (
                <optgroup key={category} label={`Categoria ${category}`}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.description}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Número do CA
            <input
              required
              value={caNumber}
              onChange={(e) => setCaNumber(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Validade do CA (opcional)
            <input
              type="date"
              value={caValidUntil}
              onChange={(e) => setCaValidUntil(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading' || !selectedItemId}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Cadastrar EPI'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">EPIs cadastrados</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {epis.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum EPI cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {epis.map((epi) => (
              <li key={epi.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">
                      {epi.code} — {epi.description}
                    </strong>
                    <span className="ml-2 text-brand-700">CA {epi.ca_number}</span>
                    {epi.ca_valid_until && (
                      <span className="ml-2 text-brand-700">(validade {formatDate(epi.ca_valid_until)})</span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setDeliveryFormEpiId(epi.id);
                        loadDeliveries(epi.id);
                      }}
                      className="text-brand-500 hover:underline"
                    >
                      Registrar entrega
                    </button>
                    <button onClick={() => handleDelete(epi.id)} className="text-red-600 hover:underline">
                      Apagar
                    </button>
                  </div>
                </div>

                {deliveriesByEpi[epi.id] && deliveriesByEpi[epi.id].length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-brand-700">
                    {deliveriesByEpi[epi.id].map((delivery) => (
                      <li key={delivery.id}>
                        {employeeName(delivery.employee_id)} — entregue em{' '}
                        {formatDate(delivery.delivered_at)} — confirmado por {delivery.signed_by_name}
                      </li>
                    ))}
                  </ul>
                )}

                {deliveryFormEpiId === epi.id && (
                  <form
                    onSubmit={(e) => handleRegisterDelivery(e, epi.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Funcionário
                      <select
                        required
                        value={deliveryEmployeeId}
                        onChange={(e) => setDeliveryEmployeeId(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      >
                        <option value="">Selecione</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Data da entrega
                      <input
                        required
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Nome de quem confere a entrega
                      <input
                        required
                        value={deliverySignedBy}
                        onChange={(e) => setDeliverySignedBy(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      />
                    </label>
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Confirmar entrega
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeliveryFormEpiId(null)}
                        className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
