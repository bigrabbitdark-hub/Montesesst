'use client';

import { FormEvent, useState } from 'react';

import { CNPJ_MESSAGES, formatCnpj, isValidCnpj, onlyDigits } from '@/lib/cnpj';
import { useCnpjLookup } from '@/lib/useCnpjLookup';

export interface CompanyUnit {
  id: string;
  name: string;
  cnpj?: string | null;
  legal_name?: string | null;
  notes?: string | null;
  address_street: string;
  address_number: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
  cnae_code?: string | null;
  cnae_description?: string | null;
  is_matriz: boolean;
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.message === 'string' ? body.message : fallback;
}

// Formulário único para cadastrar e editar filial: mesma consulta de CNPJ, mesmas
// validações e mesmos campos nos dois casos. A consulta só PREENCHE CAMPOS VAZIOS
// deste formulário — nunca grava nada sozinha e nunca toca na empresa matriz.
function UnitForm({
  unit,
  submitLabel,
  onSaved,
  onCancel,
}: {
  unit?: CompanyUnit;
  submitLabel: string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const editing = !!unit;
  const [name, setName] = useState(unit?.name ?? '');
  const [cnpj, setCnpj] = useState(unit?.cnpj ? formatCnpj(unit.cnpj) : '');
  const [legalName, setLegalName] = useState(unit?.legal_name ?? '');
  const [street, setStreet] = useState(unit?.address_street ?? '');
  const [number, setNumber] = useState(unit?.address_number ?? '');
  const [complement, setComplement] = useState(unit?.address_complement ?? '');
  const [neighborhood, setNeighborhood] = useState(unit?.address_neighborhood ?? '');
  const [city, setCity] = useState(unit?.address_city ?? '');
  const [state, setState] = useState(unit?.address_state ?? '');
  const [zip, setZip] = useState(unit?.address_zip ?? '');
  const [cnaeCode, setCnaeCode] = useState(unit?.cnae_code ?? '');
  const [cnaeDescription, setCnaeDescription] = useState(unit?.cnae_description ?? '');
  const [notes, setNotes] = useState(unit?.notes ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [cnpjError, setCnpjError] = useState('');

  const fillIfEmpty = (setter: (updater: (current: string) => string) => void, value: string | null) => {
    if (value) setter((current) => (current.trim() ? current : value));
  };
  const { state: lookupState, lookup } = useCnpjLookup((data) => {
    fillIfEmpty(setLegalName, data.razao_social);
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isValidCnpj(cnpj)) {
      setCnpjError(CNPJ_MESSAGES.invalid);
      return;
    }
    setCnpjError('');
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    // Na edição, campo vazio precisa ir como '' para poder limpar o valor salvo;
    // no cadastro novo, vazio simplesmente não é enviado.
    const opt = (value: string) => (editing ? value : value || undefined);
    try {
      const res = await fetch(editing ? `/api/company-units/${unit!.id}` : '/api/company-units', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          cnpj: onlyDigits(cnpj),
          legal_name: opt(legalName),
          address_street: street,
          address_number: opt(number),
          address_complement: opt(complement),
          address_neighborhood: opt(neighborhood),
          address_city: city,
          address_state: state,
          address_zip: zip,
          cnae_code: opt(cnaeCode),
          cnae_description: opt(cnaeDescription),
          notes: opt(notes),
        }),
      });
      if (res.ok) {
        setStatus('idle');
        onSaved();
        return;
      }
      setErrorMessage(await errorFrom(res, 'Não foi possível salvar. Tente de novo.'));
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  const input = 'rounded-md border border-brand-100 px-3 py-2';
  const label = 'flex flex-col gap-1 text-sm text-brand-900';

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={editing ? `Editar filial ${unit!.name}` : 'Nova filial'}
      className="mt-4 flex flex-col gap-4"
    >
      <label className={label}>
        Nome da filial
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sede" className={input} />
      </label>
      <label className={label}>
        CNPJ da filial
        <input
          required
          inputMode="numeric"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
          onBlur={() => {
            setCnpjError('');
            void lookup(cnpj);
          }}
          placeholder="00.000.000/0000-00"
          className={input}
        />
        <span role="status" aria-live="polite" className="text-xs">
          {lookupState.status === 'loading' && <span className="text-brand-700">Consultando CNPJ...</span>}
          {lookupState.status === 'erro' && <span className="text-red-600">{lookupState.message}</span>}
          {lookupState.status === 'done' && (
            <span className="text-brand-700">
              Campos vazios preenchidos pela consulta (BrasilAPI / Receita Federal). Confira e corrija antes de salvar.
            </span>
          )}
          {cnpjError && <span className="text-red-600">{cnpjError}</span>}
        </span>
      </label>
      <label className={label}>
        Razão social (opcional)
        <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Rua
        <input required value={street} onChange={(e) => setStreet(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Número
        <input value={number} onChange={(e) => setNumber(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Complemento (opcional)
        <input value={complement} onChange={(e) => setComplement(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Bairro (opcional)
        <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Cidade
        <input required value={city} onChange={(e) => setCity(e.target.value)} className={input} />
      </label>
      <label className={label}>
        UF
        <input
          required
          maxLength={2}
          value={state}
          onChange={(e) => setState(e.target.value.toUpperCase())}
          className={`${input} uppercase`}
        />
      </label>
      <label className={label}>
        CEP
        <input required value={zip} onChange={(e) => setZip(e.target.value)} className={input} />
      </label>
      <label className={label}>
        CNAE principal (opcional)
        <input
          inputMode="numeric"
          maxLength={7}
          value={cnaeCode}
          onChange={(e) => setCnaeCode(e.target.value.replace(/\D/g, ''))}
          className={input}
        />
      </label>
      <label className={label}>
        Descrição do CNAE (opcional)
        <input value={cnaeDescription} onChange={(e) => setCnaeDescription(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Observação (opcional)
        <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
      </label>
      {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-brand-700 hover:underline">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export function FiliaisForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Muda a key após cadastrar para reiniciar o formulário em branco.
  const [formKey, setFormKey] = useState(0);

  const filiais = units.filter((unit) => !unit.is_matriz);

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">2. Filiais (opcional)</h2>
      <p className="mt-1 text-sm text-brand-700">
        Se a empresa tiver mais de um endereço, cadastre aqui. Se for só a matriz, pode pular esta
        etapa.
      </p>
      {filiais.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {filiais.map((unit) => (
            <li key={unit.id} className="text-sm text-brand-700">
              <strong className="text-brand-900">{unit.name}</strong>
              {unit.legal_name ? ` (${unit.legal_name})` : ''}
              {unit.cnpj ? ` — CNPJ ${formatCnpj(unit.cnpj)}` : ' — sem CNPJ'} — {unit.address_street}
              {unit.address_number ? `, ${unit.address_number}` : ''}, {unit.address_city}/
              {unit.address_state}
              {unit.cnae_code ? ` — CNAE ${unit.cnae_code}` : ''}
              {unit.notes ? <span className="block text-xs text-brand-500">Obs.: {unit.notes}</span> : null}
              {editingId !== unit.id && (
                <button
                  type="button"
                  onClick={() => setEditingId(unit.id)}
                  className="ml-2 font-medium text-brand-500 hover:underline"
                >
                  {unit.cnpj ? 'Editar' : 'Adicionar CNPJ'}
                </button>
              )}
              {editingId === unit.id && (
                <UnitForm
                  unit={unit}
                  submitLabel="Salvar alterações"
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <UnitForm
        key={formKey}
        submitLabel="Adicionar filial"
        onSaved={() => {
          setFormKey((k) => k + 1);
          onChanged();
        }}
      />
    </section>
  );
}
