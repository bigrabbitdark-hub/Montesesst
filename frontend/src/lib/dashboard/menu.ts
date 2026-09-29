import {
  Home, Bot, Users, FileText, Shield, ShieldCheck, Flame, CirclePlus,
  GraduationCap, Calendar, Globe, CircleCheck, Coins,
  ClipboardList, Building2, FileBarChart2, Settings, type LucideIcon,
} from 'lucide-react';

export interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
}

// Rotas reais confirmadas na exploração da Fase 0 (2026-09-29); os itens
// implemented:false apontam para /empresa/em-construcao?item=<label>. Ícone
// de cada item = mapeamento EXATO da seção 6.1 da spec ("ícones do modelo
// por item"): casa, robô/chat, usuários, documento, escudo, escudo com
// check, chama, círculo com +, capelo, calendário, globo, círculo com
// check, moeda, prancheta, prédio, documento com linhas, engrenagem — nesta
// ordem. EPIs="escudo" (Shield) é DIFERENTE de Inspeções="escudo com check"
// (ShieldCheck); CIPA="círculo com +" (CirclePlus) é DIFERENTE de
// Conformidade="círculo com check" (CircleCheck) — não trocar entre si.
export const MENU_ITEMS: MenuItem[] = [
  { href: '/empresa/dashboard', label: 'Início', icon: Home, implemented: true },
  { href: '/empresa/assistente', label: 'Assistente Montese', icon: Bot, implemented: true },
  { href: '/empresa/em-construcao?item=Cadastros', label: 'Cadastros', icon: Users, implemented: false },
  { href: '/empresa/documentos', label: 'Documentos', icon: FileText, implemented: true },
  { href: '/empresa/epis', label: 'EPIs', icon: Shield, implemented: true },
  { href: '/empresa/inspecoes', label: 'Inspeções', icon: ShieldCheck, implemented: true },
  { href: '/empresa/brigada', label: 'Brigada de Incêndio', icon: Flame, implemented: true },
  { href: '/empresa/cipa', label: 'CIPA', icon: CirclePlus, implemented: true },
  { href: '/empresa/em-construcao?item=Treinamentos', label: 'Treinamentos', icon: GraduationCap, implemented: false },
  { href: '/empresa/em-construcao?item=Calendário SST', label: 'Calendário SST', icon: Calendar, implemented: false },
  { href: '/empresa/em-construcao?item=eSocial', label: 'eSocial', icon: Globe, implemented: false },
  { href: '/empresa/em-construcao?item=Conformidade', label: 'Conformidade', icon: CircleCheck, implemented: false },
  { href: '/empresa/em-construcao?item=Financeiro', label: 'Financeiro', icon: Coins, implemented: false },
  { href: '/empresa/em-construcao?item=Solicitações Técnicas', label: 'Solicitações Técnicas', icon: ClipboardList, implemented: false },
  { href: '/empresa/onboarding', label: 'Filiais', icon: Building2, implemented: true },
  { href: '/empresa/em-construcao?item=Relatórios', label: 'Relatórios', icon: FileBarChart2, implemented: false },
  { href: '/empresa/em-construcao?item=Configurações', label: 'Configurações', icon: Settings, implemented: false },
];
