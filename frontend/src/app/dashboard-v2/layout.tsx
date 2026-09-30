import { RoleGuard } from '@/components/RoleGuard';
import { WhatsAppButton } from '@/components/WhatsAppButton';

// Novo dashboard "Início" da empresa (/empresa/dashboard redireciona para cá). Fica fora de
// /empresa para não herdar o layout/sidebar antigos. Mesma guarda de papel e mesmo botão de
// WhatsApp do layout de /empresa.
export default function DashboardV2Layout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['empresa']}>
      {children}
      <WhatsAppButton />
    </RoleGuard>
  );
}
