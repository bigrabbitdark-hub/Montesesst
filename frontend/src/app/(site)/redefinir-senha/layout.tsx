import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Página de uso único, aberta a partir de um link de e-mail: fora de buscadores
// e sem enviar Referer a ninguém.
export const metadata: Metadata = {
  title: 'Redefinir senha — Montese SST',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function RedefinirSenhaLayout({ children }: { children: ReactNode }) {
  return children;
}
