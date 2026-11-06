'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAtuando } from '@/lib/useAtuando';
import { rotaBloqueadaAtuando } from '@/lib/dashboard/menu';

// Link que vira texto simples (sem parecer clicável) quando aponta para área bloqueada no modo atuação.
export function LinkOuTexto({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const atuando = useAtuando();
  const caminho = href.split(/[?#]/)[0];
  if (atuando === true && rotaBloqueadaAtuando(caminho)) {
    return <span className={className?.replace(/hover:underline/g, '').trim()}>{children}</span>;
  }
  return <Link href={href} className={className}>{children}</Link>;
}
