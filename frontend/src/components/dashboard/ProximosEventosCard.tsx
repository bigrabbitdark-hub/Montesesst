import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { ItemLista } from '@/lib/dashboard/real';

export function ProximosEventosCard({ itens }: { itens: ItemLista[] }) {
  return (
    <Card title="Próximos eventos" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">Nos próximos 7 dias</p>
      {itens.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhum evento nos próximos 7 dias.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {itens.map((e) => (
            <li key={e.id} className="rounded-xl bg-dash-page px-3.5 py-3 text-sm">
              <Link href={e.href} className="font-medium text-dash-primary hover:underline">
                {e.titulo}
              </Link>
              <p className="mt-1 flex items-center justify-between gap-2 text-[12.5px] text-dash-muted">
                <span>{e.detalhe}</span>
                <Badge tone={e.tone}>{e.rotulo}</Badge>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
