'use client';

import { FormEvent, useState } from 'react';
import { CompanyUnit } from './FiliaisForm';

interface ImportRowError {
  linha: number;
  motivo: string;
}

interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}

export function FuncionariosForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [position, setPosition] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          full_name: fullName,
          cpf,
          position: position || undefined,
          company_unit_id: unitId,
        }),
      });
      if (res.ok) {
        setFullName('');
        setCpf('');
        setPosition('');
        setStatus('ok');
        onChanged();
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  async function handleImport(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImportStatus('loading');
    setImportResult(null);
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/employees/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setImportResult(await res.json());
        setImportStatus('idle');
        onChanged();
        return;
      }
      setImportStatus('erro');
    } catch {
      setImportStatus('erro');
    }
  }

  if (units.length === 0) {
    return (
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">3. Funcionários</h2>
        <p className="mt-4 text-sm text-brand-700">
          Complete o passo 1 (matriz) primeiro — cada funcionário precisa estar vinculado a uma
          unidade.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">3. Funcionários (opcional)</h2>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome completo
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CPF
          <input
            required
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Cargo
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Filial
          <select
            required
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          >
            <option value="">Selecione</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.is_matriz ? `${unit.name} (matriz)` : unit.name}
              </option>
            ))}
          </select>
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Adicionar outro'}
        </button>
      </form>

      <div className="mt-6 border-t border-brand-100 pt-6">
        <h3 className="text-sm font-bold text-brand-900">Importar em massa (CSV)</h3>
        <p className="mt-1 text-sm text-brand-700">
          Cabeçalho obrigatório: <code>nome,cpf,cargo,filial</code> — o nome da filial precisa
          bater com uma das já cadastradas acima.
        </p>
        <form onSubmit={handleImport} className="mt-3 flex flex-col gap-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-brand-900"
          />
          {importStatus === 'erro' && (
            <p className="text-sm text-red-600">Não foi possível importar. Tente de novo.</p>
          )}
          <button
            type="submit"
            disabled={!file || importStatus === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importStatus === 'loading' ? 'Importando...' : 'Importar CSV'}
          </button>
        </form>
        {importResult && (
          <div className="mt-4 text-sm">
            <p className="text-green-700">{importResult.importados} funcionário(s) importado(s).</p>
            {importResult.erros.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-red-600">
                {importResult.erros.map((erro) => (
                  <li key={erro.linha}>
                    Linha {erro.linha}: {erro.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
