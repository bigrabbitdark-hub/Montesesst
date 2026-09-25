'use client';

import { FormEvent, useState } from 'react';
import { AuthSplit } from '@/components/AuthSplit';

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
      <AuthSplit
        photo="/photos/trabalhador-epi.jpg"
        photoAlt=""
        quote="Time real do outro lado — não um chatbot genérico no lugar de gente."
      >
        <div className="text-center">
          <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Mensagem enviada</h1>
          <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
            Obrigado pelo contato — retornaremos em breve.
          </p>
          <a
            href="https://wa.me/5548920031245"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-[9px] bg-[#25D366] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5a]"
          >
            Falar no WhatsApp
          </a>
        </div>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      photo="/photos/trabalhador-epi.jpg"
      photoAlt=""
      quote="Time real do outro lado — não um chatbot genérico no lugar de gente."
    >
      <div className="text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Fale com a gente</h1>
        <a
          href="https://wa.me/5548920031245"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-[9px] bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5a]"
        >
          WhatsApp: +55 48 92003-1245
        </a>

        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nome
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              E-mail
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
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
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            {status === 'erro' && (
              <p className="text-sm text-red-600">Não foi possível enviar. Tente de novo em instantes.</p>
            )}
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {status === 'loading' ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </div>
      </div>
    </AuthSplit>
  );
}
