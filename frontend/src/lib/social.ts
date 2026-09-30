// Redes sociais oficiais da Montese SST. Enquanto `href` for null o ícone
// aparece desativado ("em breve") — nunca apontar para "#". Preencher as
// URLs aqui é a única mudança necessária quando os perfis forem criados.
export type SocialNetwork = 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'x';

export interface SocialLink {
  network: SocialNetwork;
  label: string;
  href: string | null;
}

export const SOCIAL_LINKS: SocialLink[] = [
  { network: 'instagram', label: 'Instagram', href: null },
  { network: 'facebook', label: 'Facebook', href: null },
  { network: 'linkedin', label: 'LinkedIn', href: null },
  { network: 'youtube', label: 'YouTube', href: null },
  { network: 'x', label: 'X', href: null },
];
