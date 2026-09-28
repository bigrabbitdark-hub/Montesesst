'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError('Muitas tentativas. Aguarde um pouco e tente novamente.');
        return;
      }
      if (!res.ok) {
        setError('Não foi possível enviar agora. Confira o e-mail e tente novamente.');
        return;
      }
      // Mesma tela exista a conta ou não — o backend não revela isso.
      setSent(true);
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Esqueci minha senha</h1>

        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          {sent ? (
            <div role="status" className="flex flex-col gap-4 text-sm text-brand-900">
              <p>
                Se o e-mail <strong>{email}</strong> estiver cadastrado, enviamos as instruções para criar uma nova senha.
                O link vale por 1 hora.
              </p>
              <p className="text-brand-700">Não chegou? Confira a caixa de spam e, se precisar, peça um novo link.</p>
              <Link href="/login" className="text-center font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900">
                Voltar para entrar
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-brand-700">
                Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.
              </p>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                E-mail
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar link'}
              </button>
              <Link href="/login" className="text-center text-sm text-brand-700 underline underline-offset-2 hover:text-brand-900">
                Voltar para entrar
              </Link>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
