'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface GoogleStatus {
  connected: boolean;
  google_email?: string;
}

export default function TecnicoConfiguracoesPage() {
  return (
    <Suspense
      fallback={<div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>}
    >
      <TecnicoConfiguracoesContent />
    </Suspense>
  );
}

function TecnicoConfiguracoesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  function loadStatus() {
    const token = localStorage.getItem('montese_token');
    fetch('/api/google-calendar/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar o status da conexão com o Google.');
        setLoading(false);
      });
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConectar() {
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/google-calendar/auth-url', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    }
  }

  async function handleDesconectar() {
    setDisconnecting(true);
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/google-calendar/desconectar', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      loadStatus();
    } else {
      setError('Não foi possível desconectar.');
    }
    setDisconnecting(false);
  }

  const googleResult = searchParams.get('google');

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Configurações</h1>

      {googleResult === 'conectado' && (
        <p className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
          Conta do Google conectada com sucesso.
        </p>
      )}
      {googleResult === 'erro' && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
          Não foi possível conectar a conta do Google. Tente novamente.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Google Calendar</h2>
        <p className="mt-1 text-sm text-brand-700">
          Conecte sua conta do Google pra que reuniões e visitas confirmadas apareçam automaticamente na sua
          agenda, com link do Google Meet quando for reunião.
        </p>
        {status?.connected ? (
          <div className="mt-4 flex items-center justify-between rounded-md bg-brand-50 p-3">
            <span className="text-sm text-brand-900">Conectado como {status.google_email}</span>
            <button
              onClick={handleDesconectar}
              disabled={disconnecting}
              className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {disconnecting ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleConectar}
            className="mt-4 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Conectar Google Calendar
          </button>
        )}
      </section>
    </div>
  );
}
