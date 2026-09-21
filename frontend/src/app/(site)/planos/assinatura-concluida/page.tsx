import Link from 'next/link';
import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';

export default function AssinaturaConcluidaPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-brand-900">Assinatura em processamento</h1>
      <p className="mt-4 text-brand-700">
        Recebemos sua assinatura e estamos confirmando o pagamento com o Mercado Pago — isso
        pode levar alguns instantes.
      </p>
      <Link
        href="/login"
        className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
      >
        Entrar
      </Link>
      <PaymentIssuerNote className="mt-8" />
    </div>
  );
}
