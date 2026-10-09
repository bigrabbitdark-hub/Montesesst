import { Brain, ClipboardList, FileCheck, Gavel, Landmark, Newspaper, Scale, Stethoscope, TriangleAlert, Users, type LucideIcon } from 'lucide-react';

interface CoverStyle {
  icon: LucideIcon;
  background: string;
  iconColor: string;
}

const DARK = 'bg-gradient-to-br from-brand-900 to-brand-700';
const MID = 'bg-gradient-to-br from-brand-700 to-brand-500';
const LIGHT = 'bg-gradient-to-br from-brand-100 to-brand-300';

const COVERS: Record<string, CoverStyle> = {
  'NR-1 e riscos psicossociais': { icon: Brain, background: DARK, iconColor: 'text-brand-100' },
  'Normas Regulamentadoras': { icon: Scale, background: MID, iconColor: 'text-white' },
  'eSocial SST': { icon: FileCheck, background: LIGHT, iconColor: 'text-brand-900' },
  'Medicina Ocupacional': { icon: Stethoscope, background: MID, iconColor: 'text-white' },
  'PGR, PCMSO e LTCAT': { icon: ClipboardList, background: DARK, iconColor: 'text-brand-100' },
  'Acidentes de Trabalho': { icon: TriangleAlert, background: LIGHT, iconColor: 'text-brand-900' },
  'Fiscalização e Multas': { icon: Gavel, background: DARK, iconColor: 'text-brand-100' },
  'Gestão para RH': { icon: Users, background: LIGHT, iconColor: 'text-brand-900' },
  'Jurisprudência Trabalhista': { icon: Landmark, background: MID, iconColor: 'text-white' },
};

const FALLBACK: CoverStyle = { icon: Newspaper, background: MID, iconColor: 'text-white' };

// Capa decorativa (aria-hidden): o título e a categoria já estão no texto do card.
export function NewsCover({ category, className = 'h-32' }: { category?: string; className?: string }) {
  const { icon: Icon, background, iconColor } = (category && COVERS[category]) || FALLBACK;
  return (
    <div aria-hidden="true" className={`relative flex items-center justify-center overflow-hidden ${background} ${className}`}>
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-2/5 w-full">
        <polygon points="0,100 0,60 70,25 130,60 200,10 270,55 330,25 400,60 400,100" fill="white" opacity="0.12" />
        <polygon points="0,100 0,78 90,48 170,78 250,38 330,76 400,52 400,100" fill="white" opacity="0.16" />
      </svg>
      <Icon className={`relative h-10 w-10 ${iconColor}`} strokeWidth={1.6} />
    </div>
  );
}
