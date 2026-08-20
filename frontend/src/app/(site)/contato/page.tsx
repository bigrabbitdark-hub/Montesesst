'use client';

import { FormEvent, useState } from 'react';

export default function ContatoPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      setStatus(res.ok ? 'ok' : 'erro');
    } catch {
      setStatus('erro');
    }
  }

  if (status === 'ok') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Mensagem enviada</h1>
        <p className="mt-4 text-brand-700">Obrigado pelo contato — retornaremos em breve.</p>
        <a
          href="https://wa.me/5548920031245"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-md bg-green-600 px-6 py-3 font-medium text-white hover:bg-green-700"
        >
          Falar no WhatsApp
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Fale com a gente</h1>
      <a
        href="https://wa.me/5548920031245"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
      >
        WhatsApp: +55 48 92003-1245
      </a>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Mensagem
          <textarea
            required
            minLength={10}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && (
          <p className="text-sm text-red-600">Não foi possível enviar. Tente de novo em instantes.</p>
        )}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
