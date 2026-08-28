import { EmpresaSidebar } from '@/components/EmpresaSidebar';

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <EmpresaSidebar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
