import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-brand-100 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-sm text-brand-700">
        <Logo />
        <p>Tecnologia que organiza. Gestão que protege.</p>
        <p>&copy; {new Date().getFullYear()} Montese SST</p>
      </div>
    </footer>
  );
}
