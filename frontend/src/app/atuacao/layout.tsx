import { AtuacaoShell } from '@/components/dashboard/AtuacaoShell';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';

export default function AtuacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['socio']}>
      <AtuacaoShell>
        <DashSkin>
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </DashSkin>
      </AtuacaoShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
