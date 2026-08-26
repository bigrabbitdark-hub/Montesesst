'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EpisPanel } from '@/components/EpisPanel';

export default function EmpresaEpisPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Catálogo de EPI</h1>
      <div className="mt-8">
        <EpisPanel />
      </div>
    </div>
  );
}
