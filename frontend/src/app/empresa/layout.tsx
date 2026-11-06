import { EmpresaShell } from '@/components/dashboard/EmpresaShell';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { ActingBanner } from '@/components/ActingBanner';
import { RoleGuard } from '@/components/RoleGuard';

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['empresa']}>
      <ActingBanner />
      <EmpresaShell>
        {/* Mesma largura máxima que as páginas internas tinham na casca antiga. */}
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </EmpresaShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
