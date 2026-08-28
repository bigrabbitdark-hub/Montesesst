import { AdminSidebar } from '@/components/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <AdminSidebar />
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  );
}
