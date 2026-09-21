import { company } from '@/lib/company';

export function DashboardFooter() {
  return (
    <footer className="border-t border-brand-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-brand-700 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>{`© ${new Date().getFullYear()} Montese SST · CNPJ ${company.cnpj}. Todos os direitos reservados.`}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <a href="mailto:contato@montesesst.com.br" className="hover:text-brand-900 hover:underline">
            Suporte: contato@montesesst.com.br
          </a>
          <a
            href="https://wa.me/5548920031245"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-brand-900 hover:underline"
          >
            WhatsApp: +55 48 92003-1245
          </a>
        </div>
      </div>
    </footer>
  );
}
