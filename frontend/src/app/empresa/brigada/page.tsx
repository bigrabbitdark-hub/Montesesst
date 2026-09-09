'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FireBrigadePanel } from '@/components/FireBrigadePanel';

export default function EmpresaBrigadaPage() {
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
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Brigada de incêndio</h1>
      <div className="mt-8">
        <FireBrigadePanel />
      </div>
    </div>
  );
}
