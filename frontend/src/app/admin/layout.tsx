import { AdminSidebar } from '@/components/AdminSidebar';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <AdminSidebar />
        <main className="flex-1 px-8 py-10">{children}</main>
      </div>
      <DashboardFooter />
      <WhatsAppButton />
    </div>
  );
}
