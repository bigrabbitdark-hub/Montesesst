import { company } from '@/lib/company';

// Rodapé enxuto do painel (o DashboardFooter continua sendo o de empresa e técnico).
export function AdminFooter() {
  return (
    <footer className="border-t border-brand-100 px-4 py-4 text-xs text-brand-700 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <p>{`Montese Control · ${company.nomeFantasia} · CNPJ ${company.cnpj}`}</p>
        <p>{`© ${new Date().getFullYear()} Todos os direitos reservados.`}</p>
      </div>
    </footer>
  );
}
