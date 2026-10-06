import { TecnicoShell } from '@/components/dashboard/TecnicoShell';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['tecnico', 'parceiro']}>
      <TecnicoShell>
        {/* O skin remapeia os tokens brand-* das páginas do técnico para o DS v2, sem mexer no JSX delas. */}
        <DashSkin>
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </DashSkin>
      </TecnicoShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
