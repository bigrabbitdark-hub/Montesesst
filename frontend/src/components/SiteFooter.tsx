import Link from 'next/link';
import Image from 'next/image';
import { company } from '@/lib/company';
import { SocialLinks } from './SocialLinks';

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
          <div className="mt-5">
            <SocialLinks />
          </div>
        </div>

        <FooterColumn title="Produto">
          <FooterLink href="/planos">Planos</FooterLink>
          <FooterLink href="/cursos">Cursos</FooterLink>
          <FooterLink href="/noticias">Notícias</FooterLink>
        </FooterColumn>

        <FooterColumn title="Empresa">
          <FooterLink href="/quem-somos">Quem somos</FooterLink>
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
