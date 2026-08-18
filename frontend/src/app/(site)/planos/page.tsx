import Link from 'next/link';

export const metadata = { title: 'Planos — Montese SST' };

export default function PlanosPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-brand-900">Planos</h1>
      <p className="mt-4 text-brand-700">
        Estamos validando o modelo de atendimento na região Sul de Santa Catarina antes de
        fechar uma tabela de preços — cada empresa começa com um período de teste (trial) sem
        custo. Fale com a gente pra saber o que faz sentido pro seu time.
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link
          href="/cadastro"
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Comece grátis
        </Link>
        <Link
          href="/contato"
          className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
        >
          Fale com vendas
        </Link>
      </div>
    </div>
  );
}
