'use client';

import { FormEvent, useState } from 'react';

export interface CompanyUnit {
  id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
}

export function FiliaisForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/company-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          address_street: street,
          address_number: number || undefined,
          address_city: city,
          address_state: state,
          address_zip: zip,
        }),
      });
      if (res.ok) {
        setName('');
        setStreet('');
        setNumber('');
        setCity('');
        setState('');
        setZip('');
        setStatus('ok');
        onChanged();
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">Filiais</h2>
      {units.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {units.map((unit) => (
            <li key={unit.id} className="text-sm text-brand-700">
              <strong className="text-brand-900">{unit.name}</strong> — {unit.address_street}
              {unit.address_number ? `, ${unit.address_number}` : ''}, {unit.address_city}/
              {unit.address_state}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome da filial
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sede"
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
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
          Número
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
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Adicionar filial'}
        </button>
      </form>
    </section>
  );
}
