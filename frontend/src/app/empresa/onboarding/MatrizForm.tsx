'use client';

import { FormEvent, useEffect, useState } from 'react';

import { getToken } from '@/lib/auth';
import { CnpjData } from '@/lib/cnpj';
import { useCnpjLookup } from '@/lib/useCnpjLookup';

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
  notes?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  cnae_code?: string | null;
  cnae_description?: string | null;
}

// Passo 1 do onboarding — o único obrigatório de verdade (não dá pra
// pular). Salva tudo de uma vez (não é mais autosave campo a campo como
// antes) porque agora é um "avançar" de wizard, não uma tela livre.
export function MatrizForm({
  tenant,
  onSaved,
  onLogoChanged,
}: {
  tenant: TenantData;
  onSaved: () => void;
  onLogoChanged: () => void;
}) {
  const [notes, setNotes] = useState(tenant.notes ?? '');
  const [sector, setSector] = useState(tenant.sector ?? '');
  const [street, setStreet] = useState(tenant.address_street ?? '');
  const [number, setNumber] = useState(tenant.address_number ?? '');
  const [city, setCity] = useState(tenant.address_city ?? '');
  const [state, setState] = useState(tenant.address_state ?? '');
  const [zip, setZip] = useState(tenant.address_zip ?? '');
  const [neighborhood, setNeighborhood] = useState(tenant.address_neighborhood ?? '');
  const [complement, setComplement] = useState(tenant.address_complement ?? '');
  const [cnaeCode, setCnaeCode] = useState(tenant.cnae_code ?? '');
  const [cnaeDescription, setCnaeDescription] = useState(tenant.cnae_description ?? '');
  const [contactName, setContactName] = useState(tenant.contact_name ?? '');
  const [contactRole, setContactRole] = useState(tenant.contact_role ?? '');
  const [contactPhone, setContactPhone] = useState(tenant.contact_phone ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [logoStatus, setLogoStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  // Consulta pelo CNPJ da própria empresa (imutável). Só preenche campo
  // vazio — o que o usuário já digitou ou que já estava salvo nunca é trocado.
  const fillIfEmpty = (setter: (updater: (current: string) => string) => void, value: string | null) => {
    if (value) setter((current) => (current.trim() ? current : value));
  };
  const { state: lookupState, lookup } = useCnpjLookup((data: CnpjData) => {
    fillIfEmpty(setStreet, data.address_street);
    fillIfEmpty(setNumber, data.address_number);
    fillIfEmpty(setComplement, data.address_complement);
    fillIfEmpty(setNeighborhood, data.address_neighborhood);
    fillIfEmpty(setCity, data.address_city);
    fillIfEmpty(setState, data.address_state);
    fillIfEmpty(setZip, data.address_zip);
    fillIfEmpty(setCnaeCode, data.cnae_code);
    fillIfEmpty(setCnaeDescription, data.cnae_description);
  });

  // Automático uma única vez, e só se a matriz ainda não tem endereço nem CNAE.
  useEffect(() => {
    const semDados = !tenant.address_street && !tenant.address_city && !tenant.address_zip && !tenant.cnae_code;
    if (semDados) void lookup(tenant.cnpj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = getToken();
    try {
      const res = await fetch('/api/tenants/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          notes,
          sector: sector || undefined,
          address_street: street,
          address_number: number || undefined,
          address_city: city,
          address_state: state,
          address_zip: zip,
          address_neighborhood: neighborhood,
          address_complement: complement,
          cnae_code: cnaeCode,
          cnae_description: cnaeDescription,
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
        onLogoChanged();
        window.dispatchEvent(new Event('montese:tenant-updated'));
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
        onLogoChanged();
        window.dispatchEvent(new Event('montese:tenant-updated'));
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
        <div className="flex flex-col gap-1 text-sm text-brand-900" aria-live="polite">
          <button
            type="button"
            onClick={() => lookup(tenant.cnpj, true)}
            disabled={lookupState.status === 'loading'}
            className="self-start rounded-md border border-brand-300 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {lookupState.status === 'loading' ? 'Consultando CNPJ...' : 'Preencher dados pelo CNPJ'}
          </button>
          {lookupState.status === 'erro' && <p className="text-red-600">{lookupState.message}</p>}
          {lookupState.status === 'done' && (
            <p className="text-brand-700">
              Campos vazios preenchidos pela consulta (BrasilAPI / Receita Federal). Confira e corrija antes de salvar.
            </p>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Observação (opcional)
          <textarea
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
          Complemento (opcional)
          <input
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Bairro (opcional)
          <input
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
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

        <p className="mt-2 text-sm font-medium text-brand-900">Atividade principal (CNAE)</p>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CNAE principal (opcional)
          <input
            inputMode="numeric"
            maxLength={7}
            value={cnaeCode}
            onChange={(e) => setCnaeCode(e.target.value.replace(/\D/g, ''))}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Descrição do CNAE (opcional)
          <input
            value={cnaeDescription}
            onChange={(e) => setCnaeDescription(e.target.value)}
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
