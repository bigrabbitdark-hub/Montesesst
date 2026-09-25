import Link from 'next/link';
import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';

export default function AssinaturaConcluidaPage() {
  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
          Assinatura em processamento
        </h1>
        <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
          Recebemos sua assinatura e estamos confirmando o pagamento com o Mercado Pago — isso
          pode levar alguns instantes.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Entrar
        </Link>
        <PaymentIssuerNote className="mt-8" />
      </div>
    </section>
  );
}
