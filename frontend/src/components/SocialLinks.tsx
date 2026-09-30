import { Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';
import type { ReactNode } from 'react';
import { SOCIAL_LINKS, type SocialNetwork } from '@/lib/social';

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.2h1.7L7.4 4.7H5.57l11.1 14.5z" />
    </svg>
  );
}

const ICONS: Record<SocialNetwork, ReactNode> = {
  instagram: <Instagram size={16} strokeWidth={1.9} aria-hidden="true" />,
  facebook: <Facebook size={16} strokeWidth={1.9} aria-hidden="true" />,
  linkedin: <Linkedin size={16} strokeWidth={1.9} aria-hidden="true" />,
  youtube: <Youtube size={16} strokeWidth={1.9} aria-hidden="true" />,
  x: <XIcon />,
};

const BASE = 'flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/15 bg-white/5 text-brand-100';

export function SocialLinks() {
  return (
    <ul className="flex gap-2.5">
      {SOCIAL_LINKS.map((item) => (
        <li key={item.network}>
          {item.href ? (
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.label}
              className={`${BASE} transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white`}
            >
              {ICONS[item.network]}
            </a>
          ) : (
            <span role="img" aria-label={`${item.label} (em breve)`} title={`${item.label} — em breve`} className={`${BASE} opacity-50`}>
              {ICONS[item.network]}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
