import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { diasEntre, formatarData } from '@/lib/dashboard/status';
import type { VencimentoItem } from '@/lib/dashboard/real';

// `hoje` (yyyy-mm-dd) vem por prop: nada de Date.now() aqui, para o cálculo ser testável.
export function VencimentosCard({ itens, hoje }: { itens: VencimentoItem[]; hoje: string }) {
  return (
    <Card title="Vencimentos" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">Itens em destaque com data</p>
      {itens.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhum vencimento em destaque.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((v) => {
            const dias = diasEntre(hoje, v.validade);
            const quando = dias < 0 ? `venceu há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}` : dias === 0 ? 'vence hoje' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
            return (
              <li
                key={v.id}
                className={`rounded-xl px-3.5 py-2.5 text-sm ${
                  dias < 0 ? 'bg-dash-status-crit-bg text-dash-status-crit-text' : 'bg-dash-status-warn-bg text-dash-status-warn-text'
                }`}
              >
                <Link href={v.href} className="font-semibold hover:underline">
                  {v.nome}
                </Link>
                <p className="mt-0.5 text-[13px]">
                  {quando} — {formatarData(v.validade)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
