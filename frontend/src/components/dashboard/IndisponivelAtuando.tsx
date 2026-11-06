import Link from 'next/link';

// Mensagem única para áreas que não existem no modo "atuar como empresa". `mensagem` substitui o texto
// principal quando a área tem um motivo específico (ex.: CIPA nova gestão).
export function IndisponivelAtuando({ mensagem }: { mensagem?: string } = {}) {
  return (
    <div role="status" className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-base font-semibold text-dash-primary">
        {mensagem ?? 'Esta área não está disponível no modo empresa. Saia do modo empresa para acessá-la.'}
      </p>
      <p className="mt-2 text-sm text-dash-muted">Use o botão &quot;Sair do modo empresa&quot; na faixa acima.</p>
      <Link href="/dashboard-v2" className="mt-4 inline-block text-sm font-semibold text-dash-brand-green-dark hover:underline">
        Voltar ao painel da empresa
      </Link>
    </div>
  );
}
