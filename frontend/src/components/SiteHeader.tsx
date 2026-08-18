import Link from 'next/link';
import { Logo } from './Logo';

const NAV_LINKS = [
  { href: '/planos', label: 'Planos' },
  { href: '/noticias', label: 'Notícias' },
  { href: '/contato', label: 'Contato' },
];

export function SiteHeader() {
  return (
    <header className="border-b border-brand-100">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-brand-900 hover:text-brand-700">
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="text-sm text-brand-900 hover:text-brand-700">
            Entrar
          </Link>
          <Link
            href="/cadastro"
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Comece grátis
          </Link>
        </nav>
      </div>
    </header>
  );
}
