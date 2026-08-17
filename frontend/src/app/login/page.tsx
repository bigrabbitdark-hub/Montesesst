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
      router.push('/');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 360 }}>
      <h1>Entrar — Montese SST</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
