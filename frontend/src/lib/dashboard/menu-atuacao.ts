import { LayoutDashboard, Building2, ListChecks, CalendarDays, Wallet, FileText } from 'lucide-react';
import type { MenuItem } from './menu';

// Menu do sócio (Painel de Atuação). Só rotas /atuacao/* que existem hoje;
// Demais itens entram nas próximas fases.
export const ATUACAO_MENU_ITEMS: MenuItem[] = [
  { href: '/atuacao', label: 'Painel', icon: LayoutDashboard, implemented: true },
  { href: '/atuacao/clientes', label: 'Clientes Montese', icon: Building2, implemented: true },
  { href: '/atuacao/tarefas', label: 'Minhas tarefas', icon: ListChecks, implemented: true },
  { href: '/atuacao/agenda', label: 'Agenda', icon: CalendarDays, implemented: true },
  { href: '/atuacao/financeiro', label: 'Financeiro', icon: Wallet, implemented: true },
  { href: '/atuacao/documentos', label: 'Documentos', icon: FileText, implemented: true },
];
