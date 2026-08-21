'use client';

import { FormEvent, useState } from 'react';

export interface TenantData {
  id: string;
  name: string;
  cnpj: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

export function DadosEmpresaForm({ tenant, onSaved }: { tenant: TenantData; onSaved: () => void }) {
  const [sector, setSector] = useState(tenant.sector ?? '');
  const [contactName, setContactName] = useState(tenant.contact_name ?? '');
  const [contactPhone, setContactPhone] = useState(tenant.contact_phone ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/tenants/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sector: sector || undefined,
          contact_name: contactName || undefined,
          contact_phone: contactPhone || undefined,
        }),
      });
      setStatus(res.ok ? 'ok' : 'erro');
      if (res.ok) onSaved();
    } catch {
      setStatus('erro');
    }
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">Dados da empresa</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Setor/atividade
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome do contato responsável
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Telefone do contato
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        {status === 'ok' && <p className="text-sm text-green-700">Salvo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </section>
  );
}
