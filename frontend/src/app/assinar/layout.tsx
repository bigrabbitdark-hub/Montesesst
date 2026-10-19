import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Página de uso único, aberta a partir de um link enviado ao funcionário: fora de buscadores e sem enviar
// Referer a ninguém. Sem o cabeçalho do site: é uma tela de tarefa única.
export const metadata: Metadata = {
  title: 'Assinatura de recebimento de EPI',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function AssinarLayout({ children }: { children: ReactNode }) {
  return children;
}
