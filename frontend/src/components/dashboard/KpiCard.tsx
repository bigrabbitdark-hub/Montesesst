import { Card } from '@/components/ui/Card';

export function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <p className="text-sm font-medium text-dash-muted">{label}</p>
      <p className="mb-1 mt-1.5 text-[40px] font-bold leading-none tracking-tight text-dash-primary">{value}</p>
      {hint && <p className="text-[13px] text-dash-muted">{hint}</p>}
    </Card>
  );
}
