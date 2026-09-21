import type { AdminIconName } from './icons';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: AdminIconName;
  keywords?: string;
}

export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

// Só páginas que existem. Itens futuros ficam de fora de propósito (evita
// links mortos); o que ainda não existe aparece como "Em construção" na
// Visão Geral.
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: '/admin/overview', label: 'Visão Geral', icon: 'home', keywords: 'inicio painel resumo dashboard' }] },
  { label: 'Financeiro', items: [{ href: '/admin/financeiro', label: 'Financeiro', icon: 'wallet', keywords: 'pagamentos assinaturas planos mercado pago cobranças' }] },
  {
    label: 'Clientes',
    items: [
      { href: '/admin/empresas', label: 'Empresas', icon: 'building', keywords: 'clientes cnpj tenants' },
      { href: '/admin/tecnicos', label: 'Técnicos', icon: 'user', keywords: 'tecnicos responsaveis' },
      { href: '/admin/parceiros', label: 'Parceiros', icon: 'users', keywords: 'parceiros campo' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/admin/normativa', label: 'Base normativa', icon: 'book', keywords: 'nr normas fontes oficiais' },
      { href: '/admin/checklist-sst', label: 'Checklist SST', icon: 'check', keywords: 'catalogo itens infracao' },
      { href: '/admin/auditoria', label: 'Auditoria', icon: 'shield', keywords: 'logs eventos acessos' },
    ],
  },
];

export const ADMIN_NAV_FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
