import { Card } from '@/components/ui/Card';

// `large`: rótulo e dica em 16px (módulo de EPI, onde a dica carrega informação operacional). Sem `large`, nada muda.
export function KpiCard({ label, value, hint, large = false }: { label: string; value: string | number; hint?: string; large?: boolean }) {
  return (
    <Card>
      <p className={`${large ? 'text-base' : 'text-sm'} font-medium text-dash-muted`}>{label}</p>
      <p className="mb-1 mt-1.5 text-[40px] font-bold leading-none tracking-tight text-dash-primary">{value}</p>
      {hint && <p className={`${large ? 'text-base' : 'text-[13px]'} text-dash-muted`}>{hint}</p>}
    </Card>
  );
}
