import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { ItemLista } from '@/lib/dashboard/real';

export function PendenciasCard({ itens, resumo }: { itens: ItemLista[]; resumo: string }) {
  return (
    <Card title="Pendências" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">{resumo}</p>
      {itens.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhuma pendência no momento.</p>
      ) : (
        <ul>
          {itens.map((p) => (
            <li key={p.id} className="border-b border-dash-border-soft py-3 last:border-0">
              <Link href={p.href} className="text-sm font-semibold text-dash-primary hover:underline">
                {p.titulo}
              </Link>
              <p className="mt-1 flex items-center justify-between gap-2 text-[12.5px] text-dash-muted">
                <span>{p.detalhe}</span>
                <Badge tone={p.tone}>{p.rotulo}</Badge>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
