import { RoleGuard } from '@/components/RoleGuard';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { EmpresaShell } from '@/components/dashboard/EmpresaShell';

// Dashboard "Início" da empresa (/empresa/dashboard redireciona para cá). Fica fora de /empresa
// por rota, mas usa a mesma casca (EmpresaShell) e a mesma guarda de papel de /empresa.
export default function DashboardV2Layout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['empresa']}>
      <EmpresaShell>{children}</EmpresaShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
