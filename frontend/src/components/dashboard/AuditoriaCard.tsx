import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
export const TOM_CRITICIDADE: Record<'Alta' | 'Média', Tone> = { Alta: 'high', Média: 'warn' };

const FALTAM = ['PGR × LTCAT', 'PPP × LTCAT', 'PPP × eSocial', 'PGR × S-2240', 'PCMSO × S-2220'];

// Só o cruzamento PGR × PCMSO existe de verdade (Pente-Fino). Os demais ficam
// declarados "em breve", sem número. `pgrPcmso` ausente = backend sem o dado.
export function AuditoriaCard({ pgrPcmso }: { pgrPcmso?: { risco_sem_exame: number; exame_sem_risco: number } }) {
  const riscos = pgrPcmso?.risco_sem_exame ?? 0;
  const exames = pgrPcmso?.exame_sem_risco ?? 0;
  return (
    <Card title="Auditoria Inteligente" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">Cruzamento de documentos</p>
      {pgrPcmso ? (
        <div className="border-b border-dash-border-soft pb-3">
          <p className="font-semibold text-dash-primary">PGR × PCMSO</p>
          {riscos + exames === 0 ? (
            <p className="mt-1 text-[13px] text-dash-muted">Nenhuma divergência encontrada no Pente-Fino.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-[13px] text-dash-muted">
              {riscos > 0 && (
                <li className="flex items-start justify-between gap-3">
                  <span>
                    {riscos} {riscos === 1 ? 'risco sem exame correspondente' : 'riscos sem exame correspondente'}
                  </span>
                  <Badge tone={TOM_CRITICIDADE.Alta}>Alta</Badge>
                </li>
              )}
              {exames > 0 && (
                <li className="flex items-start justify-between gap-3">
                  <span>
                    {exames} {exames === 1 ? 'exame sem risco correspondente' : 'exames sem risco correspondente'}
                  </span>
                  <Badge tone={TOM_CRITICIDADE.Média}>Média</Badge>
                </li>
              )}
            </ul>
          )}
          <Link href="/empresa/pente-fino" className="mt-2 inline-block text-[13px] font-semibold text-dash-brand-green-dark hover:underline">
            Abrir Pente-Fino
          </Link>
        </div>
      ) : (
        <p className="border-b border-dash-border-soft pb-3 text-sm text-dash-muted">PGR × PCMSO: dado indisponível no momento.</p>
      )}
      <p className="mt-3 text-[13px] text-dash-muted">
        <span className="font-semibold text-dash-primary">Em breve:</span> {FALTAM.join(', ')}.
      </p>
    </Card>
  );
}
