import { Card } from '@/components/ui/Card';

// Bloco sem fonte real no backend: nunca mostra número ou barra inventados.
export function EmBreveCard({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <Card title={titulo} className="h-full">
      <p className="mt-1 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-dash-muted">Em breve</p>
      <p className="mt-3 text-sm text-dash-muted">{descricao}</p>
    </Card>
  );
}
