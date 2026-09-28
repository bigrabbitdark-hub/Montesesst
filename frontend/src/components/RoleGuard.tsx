'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SessionUser, getToken, getUser, homeFor, isTokenExpired } from '@/lib/auth';

// ITEM 017 (auditoria 2026-09-27): os layouts de admin/empresa/técnico
// renderizavam a casca (menu, estrutura de navegação) para qualquer visitante,
// mesmo deslogado — os dados continuavam protegidos pelo backend, mas a
// estrutura do painel administrativo ficava à mostra e a tela dava a falsa
// sensação de "estar dentro". Esta guarda envolve o layout INTEIRO: enquanto a
// sessão não é confirmada nada da casca é renderizado (nem no HTML do servidor).
// É só UX/defesa em profundidade — quem autoriza é o backend.
export function RoleGuard({ allow, children }: { allow: SessionUser['role'][]; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<'verificando' | 'liberado' | 'redirecionando'>('verificando');

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user || isTokenExpired(token)) {
      // Sessão ausente ou vencida: limpa o que sobrou e vai para o login.
      if (token || user) {
        localStorage.removeItem('montese_token');
        localStorage.removeItem('montese_user');
      }
      setState('redirecionando');
      router.replace('/login');
      return;
    }
    if (!allow.includes(user.role)) {
      setState('redirecionando');
      router.replace(homeFor(user.role));
      return;
    }
    setState('liberado');
    // `allow` é uma constante literal em cada layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (state !== 'liberado') {
    return (
      <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center px-4 text-sm text-brand-700">
        {state === 'verificando' ? 'Verificando acesso...' : 'Redirecionando...'}
      </div>
    );
  }
  return <>{children}</>;
}

