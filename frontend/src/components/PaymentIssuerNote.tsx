import { company } from '@/lib/company';

// Identifica quem recebe o pagamento. Só o CNPJ — o endereço comercial fica
// restrito aos documentos legais (decisão do fundador).
export function PaymentIssuerNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-brand-700 ${className}`}>
      {`Pagamento processado pelo Mercado Pago · ${company.nomeFantasia} · CNPJ ${company.cnpj}`}
    </p>
  );
}
