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

// Setor da sidebar da Empresa (Dashboard v2) com título semântico opcional.
// `titulo: null` = topo sem rótulo (itens vão direto na lista principal).
export interface MenuSetor {
  titulo: string | null;
  itens: MenuItem[];
}

// Fonte única dos 24 itens da Empresa, organizados por setor.
// Os objetos de item existem uma única vez aqui; nada é duplicado em outra lista.
// `MENU_ITEMS` abaixo é uma visão plana (ordem dos setores) usada por dependentes
// que ainda não migraram para `MENU_SETORES`.
export const MENU_SETORES: MenuSetor[] = [
  { titulo: null, itens: [
    { href: '/dashboard-v2', label: 'Dashboard', icon: LayoutDashboard, implemented: true },
    { href: '/empresa/assistente', label: 'Assistente Montese', icon: Bot, implemented: true },
  ]},
  { titulo: 'Empresa', itens: [
    { href: '/empresa/onboarding', label: 'Empresas', icon: Building2, implemented: true },
    { href: '/empresa/em-construcao?item=Funcionários', label: 'Funcionários', icon: Users, implemented: false },
    { href: '/empresa/documentos', label: 'Documentos', icon: FileText, implemented: true },
    { href: '/empresa/inspecoes', label: 'Relatório de visita técnica', icon: ClipboardCheck, implemented: true },
  ]},
  { titulo: 'CIPA', itens: [
    { href: '/empresa/cipa', label: 'CIPA', icon: CircleCheck, implemented: true },
    { href: '/empresa/cipa/eleicao', label: 'Eleição da CIPA', icon: Vote, implemented: true },
    { href: '/empresa/cipa/capacitacao', label: 'Capacitação da CIPA', icon: GraduationCap, implemented: true },
  ]},
  { titulo: 'Brigada e Incêndio', itens: [
    { href: '/empresa/brigada', label: 'Brigada de Incêndio', icon: Flame, implemented: true },
    { href: '/empresa/equipamentos-incendio', label: 'Equip. contra incêndio', icon: Flame, implemented: true },
    { href: '/empresa/checklist-prevencao', label: 'Checklist prevenção', icon: ListChecks, implemented: true },
    { href: '/empresa/simulados', label: 'Simulados', icon: Siren, implemented: true },
  ]},
  { titulo: 'Segurança', itens: [
    { href: '/empresa/mapa-sst', label: 'Mapa SST', icon: MapPinned, implemented: true },
    { href: '/empresa/epis', label: 'EPIs', icon: ShieldCheck, implemented: true },
    { href: '/empresa/consulta-ca', label: 'Consulta de CA', icon: Search, implemented: true },
  ]},
  { titulo: 'Agenda', itens: [
    { href: '/empresa/agendamentos', label: 'Reuniões e Visitas', icon: CalendarClock, implemented: true },
  ]},
  { titulo: 'Gestão', itens: [
    { href: '/empresa/pente-fino', label: 'Auditoria Montese', icon: Microscope, implemented: true },
    { href: '/empresa/em-construcao?item=Auditoria IA', label: 'Auditoria IA', icon: ScanSearch, implemented: false },
    { href: '/empresa/em-construcao?item=eSocial', label: 'eSocial', icon: Globe, implemented: false },
    { href: '/empresa/em-construcao?item=Relatórios', label: 'Relatórios', icon: FileBarChart2, implemented: false },
    { href: '/empresa/em-construcao?item=Financeiro', label: 'Financeiro', icon: Coins, implemented: false },
    { href: '/empresa/em-construcao?item=Universidade', label: 'Universidade', icon: GraduationCap, implemented: false },
    { href: '/empresa/em-construcao?item=Configurações', label: 'Configurações', icon: Settings, implemented: false },
  ]},
];

// Lista plana dos 24 itens, na ordem em que aparecem nos setores. Derivada
// de MENU_SETORES — não há objetos duplicados em outro array.
export const MENU_ITEMS: MenuItem[] = MENU_SETORES.flatMap((s) => s.itens);

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
