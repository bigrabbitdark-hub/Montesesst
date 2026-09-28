import { TecnicoSidebar } from '@/components/TecnicoSidebar';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['tecnico', 'parceiro']}>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <TecnicoSidebar />
          <main className="flex-1">
            <SubscriptionNotice />
            {children}
          </main>
        </div>
        <DashboardFooter />
        <WhatsAppButton />
      </div>
    </RoleGuard>
  );
}
