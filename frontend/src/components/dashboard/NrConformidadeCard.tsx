import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { NrLinha } from '@/lib/dashboard/real';

// `itens` null = backend sem o dado (degrada como os demais cartões); [] = nenhuma NR
// marcada como aplicável. Nunca mostra número ou barra inventados.
export function NrConformidadeCard({ itens }: { itens: NrLinha[] | null }) {
  return (
    <Card title="Conformidade por NR" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">Evidências cadastradas das NRs aplicáveis à empresa</p>
      {itens === null ? (
        <p className="text-sm text-dash-muted">Dado indisponível no momento.</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-dash-muted">
          Nenhuma visita técnica registrou NRs aplicáveis à sua empresa. O técnico marca as NRs no relatório de visita técnica.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-dash-border-soft">
          {itens.map((n) => (
            <li key={n.code} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                <p className="font-semibold text-dash-primary">
                  <span>{n.code}</span> <span className="font-normal text-dash-muted">· {n.nome}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-dash-muted">{n.detalhe}</p>
                {/^https?:\/\//i.test(n.fonteUrl) && (
                  <a
                    href={n.fonteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Fonte oficial da ${n.code}`}
                    className="mt-0.5 inline-block text-[13px] font-semibold text-dash-brand-green-dark hover:underline"
                  >
                    Fonte oficial
                  </a>
                )}
              </div>
              <Badge tone={n.tone}>{n.rotulo}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-dash-faint">Baseado em evidências cadastradas. Não substitui a avaliação técnica.</p>
    </Card>
  );
}
