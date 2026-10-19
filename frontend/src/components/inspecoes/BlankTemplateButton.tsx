'use client';

import { useState } from 'react';

// Baixa o modelo em branco do relatório de visita (PDF gerado pelo
// backend a partir do mesmo checklist do relatório real). A rota exige
// token, então o download passa por fetch + blob em vez de um <a href>.
export function BlankTemplateButton({ className = '' }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch('/api/inspections/modelo-pdf', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('modelo');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modelo-relatorio-visita-tecnica.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Não foi possível baixar o modelo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`rounded-md border border-brand-500 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 ${className}`}
      >
        {loading ? 'Baixando...' : 'Baixar modelo (PDF)'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
