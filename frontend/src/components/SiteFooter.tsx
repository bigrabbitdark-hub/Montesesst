import Link from 'next/link';
import Image from 'next/image';
import { company } from '@/lib/company';

export function SiteFooter() {
  return (
    <footer className="bg-brand-900">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-10 md:grid-cols-[1.2fr_1fr_1fr_1fr_1.1fr]">
        <div>
          <div className="inline-flex rounded-lg bg-white px-3 py-2">
            <Link href="/" className="inline-flex items-center">
              <Image
                src="/brand/logo-horizontal.jpg"
                alt="Montese SST"
                width={220}
                height={73}
                className="h-9 w-auto"
              />
            </Link>
          </div>
          <p className="mt-4 max-w-xs text-sm text-brand-100">
            Conectamos pessoas, processos e segurança para chegar mais alto.
          </p>
          <div className="mt-5 flex gap-2.5">
            <SocialIcon label="Facebook" href="#">
              <path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.7c0-.9.3-1.6 1.6-1.6h1.7V3.2C16.5 3.1 15.4 3 14.2 3 11.6 3 9.9 4.6 9.9 7.4v2.4H7.2V13h2.7v8h3.6z" />
            </SocialIcon>
            <SocialIcon label="Instagram" href="#" strokeIcon>
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.2" cy="6.8" r="1" />
            </SocialIcon>
            <SocialIcon label="LinkedIn" href="#">
              <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.1c.5-1 1.9-2 3.8-2 4.1 0 4.9 2.7 4.9 6.2V21h-4v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z" />
            </SocialIcon>
            <SocialIcon label="YouTube" href="#" strokeIcon>
              <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
              <path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
            </SocialIcon>
          </div>
        </div>

        <FooterColumn title="Produto">
          <FooterLink href="/planos">Planos</FooterLink>
          <FooterLink href="/cursos">Cursos</FooterLink>
          <FooterLink href="/noticias">Notícias</FooterLink>
        </FooterColumn>

        <FooterColumn title="Empresa">
          <FooterLink href="/contato">Contato</FooterLink>
          <FooterLink href="/cadastro">Cadastre sua empresa</FooterLink>
        </FooterColumn>

        <FooterColumn title="Fale conosco">
          <FooterLink href="mailto:contato@montesesst.com.br">contato@montesesst.com.br</FooterLink>
          <FooterLink href="https://wa.me/5548920031245">+55 48 92003-1245</FooterLink>
        </FooterColumn>

        <FooterColumn title="Segurança e Privacidade">
          <FooterLink href="/privacidade">Política de Privacidade</FooterLink>
          <FooterLink href="/termos">Termos de Uso</FooterLink>
          <FooterLink href="/seguranca">Segurança da Informação</FooterLink>
          <FooterLink href="/incidentes">Incidentes de Segurança</FooterLink>
          <FooterLink href="/fornecedores">Fornecedores</FooterLink>
          <FooterLink href="/compromisso-sst">Compromisso SST</FooterLink>
          <FooterLink href="/faq-privacidade">FAQ de Privacidade</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 sm:px-10">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/logo-icon.jpg" alt="" width={22} height={22} className="rounded-[5px]" />
            <p className="text-xs text-brand-100">&copy; {new Date().getFullYear()} Montese SST. Todos os direitos reservados.</p>
          </div>
          <p className="text-xs text-brand-100">{`CNPJ ${company.cnpj} · montesesst.com.br`}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-white">{title}</h4>
      <div className="mt-4 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-brand-100 hover:text-white">
      {children}
    </Link>
  );
}

function SocialIcon({
  label,
  href,
  strokeIcon,
  children,
}: {
  label: string;
  href: string;
  strokeIcon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/15 bg-white/5 text-brand-100 transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={strokeIcon ? 'none' : 'currentColor'}
        stroke={strokeIcon ? 'currentColor' : 'none'}
        strokeWidth={strokeIcon ? 2 : undefined}
      >
        {children}
      </svg>
    </a>
  );
}
