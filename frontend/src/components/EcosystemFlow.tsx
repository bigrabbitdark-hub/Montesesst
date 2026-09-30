import Image from 'next/image';
import { BadgeCheck, Building2, UserCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Node {
  key: string;
  label: string;
  caption: string;
  icon: LucideIcon;
  /** posição em % dentro do diagrama desktop */
  x: number;
  y: number;
}

const NODES: Node[] = [
  { key: 'empresa', label: 'Sua empresa', caption: 'Contrata e acompanha', icon: Building2, x: 10, y: 50 },
  { key: 'tecnico', label: 'Técnico responsável', caption: 'Atuação remota', icon: UserCheck, x: 68, y: 20 },
  { key: 'parceiros', label: 'Técnicos parceiros', caption: 'Visitas e inspeções presenciais', icon: Users, x: 68, y: 80 },
  { key: 'conformidade', label: 'Conformidade', caption: 'Score, prazos e histórico', icon: BadgeCheck, x: 90, y: 50 },
];

// Linhas no espaço do viewBox 1000x437 (mesma proporção do contêiner).
const LINES = [
  'M 146 218 L 338 218',
  'M 452 198 C 530 150, 580 87, 646 87',
  'M 452 238 C 530 286, 580 350, 646 350',
  'M 714 87 C 800 87, 800 205, 866 208',
  'M 714 350 C 800 350, 800 231, 866 228',
];

export function EcosystemFlow() {
  return (
    <>
      {/* Desktop: mapa de relacionamento */}
      <div className="relative mx-auto hidden aspect-[1000/437] w-full max-w-5xl md:block" role="img" aria-label="Fluxo: sua empresa se conecta à Montese SST, que aciona o técnico responsável e os técnicos parceiros, resultando em conformidade.">
        <svg viewBox="0 0 1000 437" className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
          {LINES.map((d) => (
            <path key={d} d={d} stroke="var(--color-brand-300)" strokeWidth="2" strokeLinecap="round" className="flow-line" />
          ))}
        </svg>

        <div
          className="absolute flex -translate-x-1/2 -translate-y-14 flex-col items-center"
          style={{ left: '40%', top: '50%' }}
        >
          <div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-brand-700 shadow-xl shadow-brand-900/25 ring-8 ring-brand-100">
            <Image src="/brand/logo-icon-mark.png" alt="" width={320} height={153} className="h-auto w-20 brightness-0 invert" />
          </div>
          <p className="mt-4 text-base font-bold text-brand-900">Montese SST</p>
          <p className="text-[13px] text-muted">Conecta e organiza</p>
        </div>

        {NODES.map((node) => (
          <div
            key={node.key}
            className="absolute flex w-44 -translate-x-1/2 -translate-y-8 flex-col items-center text-center"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-100 bg-white shadow-lg shadow-brand-900/10">
              <node.icon size={28} strokeWidth={1.75} className="text-brand-500" aria-hidden="true" />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-brand-900">{node.label}</p>
            <p className="text-[13px] leading-snug text-muted">{node.caption}</p>
          </div>
        ))}
      </div>

      {/* Mobile: fluxo vertical */}
      <ol className="mx-auto flex max-w-sm flex-col md:hidden">
        {[{ key: 'empresa', label: 'Sua empresa', caption: 'Contrata e acompanha', icon: Building2 }, { key: 'montese', label: 'Montese SST', caption: 'Conecta e organiza', icon: Building2, brand: true }, ...NODES.slice(1)].map((step, i, arr) => (
          <li key={step.key} className="relative flex gap-4 pb-8 last:pb-0">
            {i < arr.length - 1 && (
              <svg className="absolute left-[27px] top-14 h-[calc(100%-3.5rem)] w-0.5 overflow-visible" aria-hidden="true">
                <line x1="1" y1="0" x2="1" y2="100%" stroke="var(--color-brand-300)" strokeWidth="2" className="flow-line" />
              </svg>
            )}
            <div
              className={`relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
                'brand' in step && step.brand ? 'bg-brand-700' : 'border border-brand-100 bg-white shadow-md shadow-brand-900/10'
              }`}
            >
              {'brand' in step && step.brand ? (
                <Image src="/brand/logo-icon-mark.png" alt="" width={320} height={153} className="h-auto w-9 brightness-0 invert" />
              ) : (
                <step.icon size={24} strokeWidth={1.75} className="text-brand-500" aria-hidden="true" />
              )}
            </div>
            <div className="pt-1.5">
              <p className="text-[15px] font-semibold text-brand-900">{step.label}</p>
              <p className="text-[13px] leading-snug text-muted">{step.caption}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
