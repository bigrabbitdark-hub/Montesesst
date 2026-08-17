import type { ReactNode } from 'react';

export const metadata = {
  title: 'Montese SST',
  description: 'Plataforma de gestão de Segurança e Saúde do Trabalho',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
