import type { ReactNode, SVGProps } from 'react';

export type AdminIconName =
  | 'home' | 'wallet' | 'building' | 'user' | 'users' | 'book' | 'check' | 'shield'
  | 'search' | 'bell' | 'menu' | 'close' | 'logout' | 'chevron' | 'refresh' | 'server'
  | 'dollar' | 'sparkle' | 'alert' | 'info' | 'database' | 'list' | 'settings' | 'wrench';

// Conjunto mínimo de ícones de traço (24x24) — sem biblioteca de ícones.
const PATHS: Record<AdminIconName, ReactNode> = {
  home: (<><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1" /></>),
  building: (<><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.6 3.5 2.6 3.5 5.5" /></>),
  book: (<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>),
  check: (<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></>),
  shield: (<><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3z" /><path d="m9 12 2.2 2.2L15.5 10" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  bell: (<><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  logout: (<><path d="M14 4h5v16h-5" /><path d="M4 12h11m-3-3.5 3.5 3.5-3.5 3.5" /></>),
  chevron: <path d="m6 9 6 6 6-6" />,
  refresh: (<><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>),
  server: (<><rect x="4" y="5" width="16" height="6" rx="1.5" /><rect x="4" y="13" width="16" height="6" rx="1.5" /><path d="M8 8h.01M8 16h.01" /></>),
  dollar: (<><path d="M12 3v18" /><path d="M16.5 7.5c-.8-1.3-2.5-2-4.5-2-2.5 0-4.5 1.2-4.5 3.2 0 4.8 9.5 2.4 9.5 7.1 0 2-2.2 3.2-5 3.2-2.3 0-4.2-.8-5-2.3" /></>),
  sparkle: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /></>),
  alert: (<><path d="M12 4 2.8 19h18.4L12 4z" /><path d="M12 10v4M12 17h.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  database: (<><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" /><path d="M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" /></>),
  list: (<><path d="M4 6h12M4 12h12M4 18h12" /><circle cx="19" cy="6" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="19" cy="18" r="1" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  wrench: (<><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-7 7a2 2 0 0 0 2.8 2.8l7-7a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-2.8 2.5-2.5z" /></>),
};

export function AdminIcon({
  name,
  className = 'h-5 w-5',
  ...rest
}: { name: AdminIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
