import { EmpresaSidebar } from '@/components/EmpresaSidebar';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <EmpresaSidebar />
        <main className="flex-1">{children}</main>
      </div>
      <DashboardFooter />
      <WhatsAppButton />
    </div>
  );
}
