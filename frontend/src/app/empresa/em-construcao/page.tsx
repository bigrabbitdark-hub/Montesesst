'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function Conteudo() {
  const params = useSearchParams();
  const item = params.get('item') ?? 'Este módulo';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-lg font-bold text-dash-primary">{item} está em construção</h1>
      <p className="text-sm text-dash-muted">Esta área ainda não está disponível. Volte em breve.</p>
    </div>
  );
}

export default function EmConstrucaoPage() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}
