'use client';

import { FormEvent, useState } from 'react';

import { getToken } from '@/lib/auth';

export interface TenantData {
  id: string;
  has_logo: boolean;
  name: string;
  cnpj: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  trade_name: string | null;
  contact_role: string | null;
  address_street: string | null;
  address_number: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

// Passo 1 do onboarding — o único obrigatório de verdade (não dá pra
// pular). Salva tudo de uma vez (não é mais autosave campo a campo como
// antes) porque agora é um "avançar" de wizard, não uma tela livre.
export function MatrizForm({ tenant, onSaved }: { tenant: TenantData; onSaved: () => void }) {
  const [tradeName, setTradeName] = useState(tenant.trade_name ?? '');
  const [sector, setSector] = useState(tenant.sector ?? '');
  const [street, setStreet] = useState(tenant.address_street ?? '');
  const [number, setNumber] = useState(tenant.address_number ?? '');
  const [city, setCity] = useState(tenant.address_city ?? '');
  const [state, setState] = useState(tenant.address_state ?? '');
  const [zip, setZip] = useState(tenant.address_zip ?? '');
  const [contactName, setContactName] = useState(tenant.contact_name ?? '');
  const [contactRole, setContactRole] = useState(tenant.contact_role ?? '');
  const [contactPhone, setContactPhone] = useState(tenant.contact_phone ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [logoStatus, setLogoStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = getToken();
    try {
      const res = await fetch('/api/tenants/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          trade_name: tradeName,
          sector: sector || undefined,
          address_street: street,
          address_number: number || undefined,
          address_city: city,
          address_state: state,
          address_zip: zip,
          contact_name: contactName,
          contact_role: contactRole,
          contact_phone: contactPhone || undefined,
        }),
      });
      if (res.ok) {
        setStatus('idle');
        onSaved();
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLogoStatus('loading');
    const token = getToken();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/tenants/me/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setLogoStatus('idle');
        onSaved();
        return;
      }
      setLogoStatus('erro');
    } catch {
      setLogoStatus('erro');
    }
  }

  async function handleLogoRemove() {
    setLogoStatus('loading');
    const token = getToken();
    try {
      const res = await fetch('/api/tenants/me/logo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setLogoStatus('idle');
        onSaved();
        return;
      }
      setLogoStatus('erro');
    } catch {
      setLogoStatus('erro');
    }
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">1. Dados da matriz</h2>
      <p className="mt-1 text-sm text-brand-700">
        A empresa que você já cadastrou vira a matriz. Complete os dados abaixo pra continuar.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Razão social
          <input
            disabled
            value={tenant.name}
            className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-brand-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CNPJ
          <input
            disabled
            value={tenant.cnpj}
            className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-brand-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome fantasia
          <input
            required
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <div className="flex flex-col gap-2 text-sm text-brand-900">
          <span>Logo da empresa (opcional)</span>
          {tenant.has_logo && (
            <div className="flex items-center gap-3">
              <img
                src={`/api/tenants/${tenant.id}/logo`}
                alt="Logo atual da empresa"
                className="h-12 w-12 rounded-lg border border-brand-100 object-cover"
              />
              <button
                type="button"
                onClick={handleLogoRemove}
                disabled={logoStatus === 'loading'}
                className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Remover logo
              </button>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleLogoUpload}
            disabled={logoStatus === 'loading'}
            className="text-sm"
          />
          {logoStatus === 'erro' && (
            <p className="text-sm text-red-600">
              Não foi possível processar a logo. Tente de novo (JPG ou PNG, até 2MB).
            </p>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Setor/atividade (opcional)
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>

        <p className="mt-2 text-sm font-medium text-brand-900">Endereço</p>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Rua
          <input
            required
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Número (opcional)
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Cidade
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          UF
          <input
            required
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            className="rounded-md border border-brand-100 px-3 py-2 uppercase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CEP
          <input
            required
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>

        <p className="mt-2 text-sm font-medium text-brand-900">Quem representa a empresa</p>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome do responsável
          <input
            required
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Cargo
          <input
            required
            value={contactRole}
            onChange={(e) => setContactRole(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Telefone (opcional)
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>

        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Salvar e continuar'}
        </button>
      </form>
    </section>
  );
}
