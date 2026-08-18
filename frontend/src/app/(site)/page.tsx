'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: string;
}

export default function HomePage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('montese_user');
    setUser(raw ? JSON.parse(raw) : null);
    setChecked(true);
  }, []);

  function handleLogout() {
    localStorage.removeItem('montese_token');
    localStorage.removeItem('montese_user');
    setUser(null);
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Montese SST</h1>
      {!checked ? null : user ? (
        <>
          <p>
            Logado como <strong>{user.role}</strong> (tenant: {user.tenantId ?? '—'}).
          </p>
          <button onClick={handleLogout}>Sair</button>
        </>
      ) : (
        <>
          <p>Fundação do projeto em construção.</p>
          <Link href="/login">Entrar</Link>
        </>
      )}
    </main>
  );
}
