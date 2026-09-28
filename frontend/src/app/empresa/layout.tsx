import { EmpresaSidebar } from '@/components/EmpresaSidebar';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['empresa']}>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <EmpresaSidebar />
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
