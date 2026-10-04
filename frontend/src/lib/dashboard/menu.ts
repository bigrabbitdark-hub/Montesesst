import {
  LayoutDashboard, Building2, Users, FileText, ScanSearch, Globe, FileBarChart2, Coins,
  GraduationCap, Settings, Bot, ShieldCheck, ClipboardCheck, Flame, CircleCheck, Search,
  CalendarClock, MapPinned, Microscope, ListChecks, Siren, Vote, type LucideIcon,
} from 'lucide-react';

export interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
}

// Menu principal do Design System (docs/specs/montese-design-system.md, seção 6).
// Itens sem página ainda apontam para /empresa/em-construcao?item=<label>.
export const MENU_ITEMS: MenuItem[] = [
  { href: '/dashboard-v2', label: 'Dashboard', icon: LayoutDashboard, implemented: true },
  { href: '/empresa/onboarding', label: 'Empresas', icon: Building2, implemented: true },
  { href: '/empresa/em-construcao?item=Funcionários', label: 'Funcionários', icon: Users, implemented: false },
  { href: '/empresa/documentos', label: 'Documentos', icon: FileText, implemented: true },
  { href: '/empresa/inspecoes', label: 'Relatório de visita técnica', icon: ClipboardCheck, implemented: true },
  { href: '/empresa/em-construcao?item=Auditoria IA', label: 'Auditoria IA', icon: ScanSearch, implemented: false },
  { href: '/empresa/em-construcao?item=eSocial', label: 'eSocial', icon: Globe, implemented: false },
  { href: '/empresa/em-construcao?item=Relatórios', label: 'Relatórios', icon: FileBarChart2, implemented: false },
  { href: '/empresa/em-construcao?item=Financeiro', label: 'Financeiro', icon: Coins, implemented: false },
  { href: '/empresa/em-construcao?item=Universidade', label: 'Universidade', icon: GraduationCap, implemented: false },
  { href: '/empresa/em-construcao?item=Configurações', label: 'Configurações', icon: Settings, implemented: false },
];

// Páginas de Empresa que já existem mas não estão no menu do Design System.
// Sem esta seção, trocar a sidebar antiga tiraria essas páginas da navegação.
export const EXTRA_MENU_ITEMS: MenuItem[] = [
  { href: '/empresa/assistente', label: 'Assistente Montese', icon: Bot, implemented: true },
  { href: '/empresa/epis', label: 'EPIs', icon: ShieldCheck, implemented: true },
  { href: '/empresa/brigada', label: 'Brigada de Incêndio', icon: Flame, implemented: true },
  { href: '/empresa/cipa', label: 'CIPA', icon: CircleCheck, implemented: true },
  { href: '/empresa/cipa/eleicao', label: 'Eleição da CIPA', icon: Vote, implemented: true },
  { href: '/empresa/cipa/capacitacao', label: 'Capacitação da CIPA', icon: GraduationCap, implemented: true },
  { href: '/empresa/consulta-ca', label: 'Consulta de CA', icon: Search, implemented: true },
  { href: '/empresa/agendamentos', label: 'Reuniões e Visitas', icon: CalendarClock, implemented: true },
  { href: '/empresa/mapa-sst', label: 'Mapa SST', icon: MapPinned, implemented: true },
  { href: '/empresa/pente-fino', label: 'Auditoria Montese', icon: Microscope, implemented: true },
  { href: '/empresa/equipamentos-incendio', label: 'Equip. contra incêndio', icon: Flame, implemented: true },
  { href: '/empresa/checklist-prevencao', label: 'Checklist prevenção', icon: ListChecks, implemented: true },
  { href: '/empresa/simulados', label: 'Simulados', icon: Siren, implemented: true },
];

// Item ativo = o de href mais específico que casa com o caminho (exato ou como prefixo de segmento).
// Itens com query (em construção) nunca ficam ativos: a própria página mostra o título.
export function itemAtivo(pathname: string, itens: MenuItem[]): string | null {
  let melhor: string | null = null;
  for (const { href } of itens) {
    if (href.includes('?')) continue;
    if ((pathname === href || pathname.startsWith(`${href}/`)) && (melhor === null || href.length > melhor.length)) {
      melhor = href;
    }
  }
  return melhor;
}
