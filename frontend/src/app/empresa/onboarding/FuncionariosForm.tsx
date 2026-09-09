'use client';

import { FormEvent, useState } from 'react';
import { CompanyUnit } from './FiliaisForm';
import { FileInput } from '@/components/FileInput';

interface ImportRowError {
  linha: number;
  motivo: string;
}

interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}

interface ColumnMapping {
  nome: number | null;
  cpf: number | null;
  cargo: number | null;
  filial: number | null;
}

interface ImportPreview {
  headers: string[];
  suggested_mapping: ColumnMapping;
  sample_rows: string[][];
  total_rows: number;
}

export function FuncionariosForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [position, setPosition] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');
  const [createError, setCreateError] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'analisando' | 'importando' | 'erro'>('idle');
  const [importError, setImportError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ nome: null, cpf: null, cargo: null, filial: null });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setCreateError('');
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
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível salvar. Tente de novo.');
      setStatus('erro');
    } catch {
      setCreateError('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleAnalyze(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImportStatus('analisando');
    setImportError('');
    setImportResult(null);
    setPreview(null);
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/employees/import-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data: ImportPreview = await res.json();
        setPreview(data);
        setMapping(data.suggested_mapping);
        setImportStatus('idle');
        return;
      }
      const body = await res.json().catch(() => null);
      setImportError(body?.message ?? 'Não foi possível analisar a planilha.');
      setImportStatus('erro');
    } catch {
      setImportError('Não foi possível conectar ao servidor.');
      setImportStatus('erro');
    }
  }

  async function handleConfirmImport() {
    if (!file) return;
    setImportStatus('importando');
    setImportError('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    try {
      const res = await fetch('/api/employees/import-mapped', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setImportResult(await res.json());
        setImportStatus('idle');
        setPreview(null);
        setFile(null);
        onChanged();
        return;
      }
      const body = await res.json().catch(() => null);
      setImportError(body?.message ?? 'Não foi possível importar.');
      setImportStatus('erro');
    } catch {
      setImportError('Não foi possível conectar ao servidor.');
      setImportStatus('erro');
    }
  }

  const canConfirmImport = mapping.nome !== null && mapping.cpf !== null && mapping.cargo !== null && mapping.filial !== null;

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
        {status === 'erro' && <p className="text-sm text-red-600">{createError}</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Adicionar outro'}
        </button>
      </form>

      <div className="mt-6 border-t border-brand-100 pt-6">
        <h3 className="text-sm font-bold text-brand-900">Importar em massa (CSV ou XLSX)</h3>
        <p className="mt-1 text-sm text-brand-700">
          Suba a planilha do seu jeito — nós identificamos as colunas de nome/CPF/cargo/filial
          automaticamente, e você confirma antes de importar. O nome da filial precisa bater com
          uma das já cadastradas acima.
        </p>
        <form
          onSubmit={handleAnalyze}
          className="mt-3 flex flex-col gap-3"
        >
          <FileInput
            file={file}
            onChange={(f) => {
              setFile(f);
              setPreview(null);
              setImportResult(null);
              setImportError('');
            }}
            accept=".csv,.xlsx"
            label="Escolher planilha"
          />
          {!preview && importError && <p className="text-sm text-red-600">{importError}</p>}
          <button
            type="submit"
            disabled={!file || importStatus === 'analisando'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importStatus === 'analisando' ? 'Analisando...' : 'Analisar planilha'}
          </button>
        </form>

        {preview && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-brand-100 p-4">
            <p className="text-sm text-brand-700">{preview.total_rows} linha(s) encontrada(s). Confirme o mapeamento:</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['nome', 'cpf', 'cargo', 'filial'] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm text-brand-900">
                  {field === 'nome' ? 'Nome' : field === 'cpf' ? 'CPF' : field === 'cargo' ? 'Cargo' : 'Filial'}
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [field]: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                    className="rounded-md border border-brand-100 px-3 py-2"
                  >
                    <option value="">Selecione a coluna...</option>
                    {preview.headers.map((header, i) => (
                      <option key={i} value={i}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {preview.sample_rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr>
                      {preview.headers.map((header, i) => (
                        <th key={i} className="px-2 py-1 text-left font-bold text-brand-700">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-brand-900">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importError && <p className="text-sm text-red-600">{importError}</p>}
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={!canConfirmImport || importStatus === 'importando'}
              className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {importStatus === 'importando' ? 'Importando...' : 'Confirmar e importar'}
            </button>
          </div>
        )}

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
