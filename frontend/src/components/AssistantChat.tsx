'use client';

import { FormEvent, useState } from 'react';

interface Citation {
  document_id: string;
  title: string;
  official_url: string;
}

interface QueryResult {
  answer: string | null;
  message?: string;
  citations: Citation[];
}

function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function AssistantChat() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setResult(null);
    try {
      const res = await fetch('/api/assistant/normative-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question }),
      });
      if (res.ok) {
        setResult(await res.json());
        setStatus('idle');
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  async function openCitation(documentId: string) {
    const res = await fetch(`/api/normative-documents/${documentId}/download`, { headers: authHeaders() });
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pergunte sobre uma norma de SST — ex: preciso fornecer capacete pra que função?"
          rows={3}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === 'loading' || !question.trim()}
          className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Consultando...' : 'Perguntar'}
        </button>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível consultar agora. Tente de novo.</p>}
      </form>

      {result && (
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
          {result.citations.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">Fontes</h4>
              {result.citations.map((c) => (
                <button
                  key={c.document_id}
                  onClick={() => openCitation(c.document_id)}
                  className="text-left text-sm text-brand-500 underline hover:text-brand-700"
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-brand-700">
        O Assistente organiza informação de fontes oficiais — ele não substitui a avaliação de um
        profissional de Segurança e Saúde do Trabalho legalmente habilitado.
      </p>
    </div>
  );
}
