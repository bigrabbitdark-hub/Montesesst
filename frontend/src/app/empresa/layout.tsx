import { EmpresaNav } from '@/components/EmpresaNav';

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <EmpresaNav />
      {children}
    </div>
  );
}
