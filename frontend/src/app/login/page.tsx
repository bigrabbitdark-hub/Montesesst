'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError('Credenciais inválidas.');
        return;
      }

      const data = await res.json();
      localStorage.setItem('montese_token', data.access_token);
      localStorage.setItem('montese_user', JSON.stringify(data.user));
      router.push(data.user.role === 'empresa' ? '/empresa/onboarding' : '/');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        <Logo />
      </div>
      <h1 className="text-2xl font-bold text-brand-900">Entrar</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
          Senha
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
