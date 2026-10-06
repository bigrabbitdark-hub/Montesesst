import { Building2, CalendarClock, AlarmClock, Search, Settings } from 'lucide-react';
import type { MenuItem } from './menu';

// Menu do técnico/parceiro; ícones lucide.
// Só rotas /tecnico/*: o RoleGuard de /empresa/* barra esses papéis.
export const TECNICO_MENU_ITEMS: MenuItem[] = [
  { href: '/tecnico/empresas', label: 'Suas empresas', icon: Building2, implemented: true },
  { href: '/tecnico/agendamentos', label: 'Agenda', icon: CalendarClock, implemented: true },
  { href: '/tecnico/agenda', label: 'Vencimentos', icon: AlarmClock, implemented: true },
  { href: '/tecnico/consulta-ca', label: 'Consulta de CA', icon: Search, implemented: true },
  { href: '/tecnico/configuracoes', label: 'Configurações', icon: Settings, implemented: true },
];
