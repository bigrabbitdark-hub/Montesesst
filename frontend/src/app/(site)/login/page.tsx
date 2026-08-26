'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

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
      const role = data.user.role;
      router.push(
        role === 'empresa'
          ? '/empresa/onboarding'
          : role === 'tecnico' || role === 'parceiro'
            ? '/tecnico/empresas'
            : role === 'admin'
              ? '/admin/empresas'
              : '/',
      );
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Entrar</h1>

        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              Senha
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
