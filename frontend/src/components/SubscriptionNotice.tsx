'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';

// ITEM 002/016: quando a assinatura está inativa o backend responde 403
// SUBSCRIPTION_INACTIVE em todas as rotas de dados. Sem este aviso a pessoa via
// só telas em branco, sem explicação. GET /subscriptions/me é isento do bloqueio.
export function SubscriptionNotice() {
  const [inactive, setInactive] = useState(false);
  const [plansHref, setPlansHref] = useState('/planos');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setPlansHref(getUser()?.role === 'tecnico' ? '/tecnico/planos' : '/planos');
    let cancelled = false;
    fetch('/api/subscriptions/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.access === 'inativa') setInactive(true);
      })
      .catch(() => undefined); // sem o aviso não é pior do que estava; nunca trava a tela
    return () => {
      cancelled = true;
    };
  }, []);

  if (!inactive) return null;
  return (
    <div role="alert" className="mx-4 mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Sua assinatura está inativa.</p>
      <p className="mt-1">
        Enquanto ela não for reativada, as informações da plataforma ficam indisponíveis. Seus dados continuam guardados.
      </p>
      <Link href={plansHref} className="mt-2 inline-block font-semibold underline underline-offset-2 hover:text-amber-950">
        Reativar meu plano
      </Link>
    </div>
  );
}
