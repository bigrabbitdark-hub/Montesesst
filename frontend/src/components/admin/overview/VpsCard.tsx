'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { Gauge } from '../charts/Gauge';
import { plural } from '../format';
import { deriveSystemState } from '../status-state';

const gb = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

// RAM, disco e carga vêm de /system-status (leitura instantânea do host). Rede
// e histórico de 24 h NÃO existem ainda: selo. "Carga" = média de 1 min ÷ núcleos.
export function VpsCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const d = system.data;
  const show = d && (state === 'online' || state === 'degradado');

  return (
    <Card id="vps" title="Servidor (VPS)" subtitle="Leitura instantânea" className={className}>
      {state === 'carregando' && <CardSkeleton rows={4} />}
      {state === 'sem-resposta' && <CardError onRetry={refresh} message="Não foi possível consultar o servidor." />}
      {show && d && (
        <div className="grid grid-cols-3 gap-2">
          <Gauge
            percent={d.memory.used_percent}
            label="RAM"
            caption={`${gb(d.memory.total_gb - d.memory.free_gb)} de ${gb(d.memory.total_gb)} GB`}
          />
          <Gauge
            percent={d.disk.used_percent}
            label="Disco"
            caption={`${gb(d.disk.total_gb - d.disk.free_gb)} de ${gb(d.disk.total_gb)} GB`}
          />
          <Gauge
            percent={Math.min(100, (d.cpu.load_avg_1m / d.cpu.cores) * 100)}
            label="Carga"
            caption={`${d.cpu.load_avg_1m.toFixed(2)} em ${plural(d.cpu.cores, 'núcleo', 'núcleos')}`}
          />
        </div>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Rede e histórico de 24 horas.</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
