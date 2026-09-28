import type { ReactNode } from 'react';
import './admin-theme.css';
import { AdminShell } from '@/components/admin/AdminShell';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';

export const metadata = { title: 'Montese Control — Admin' };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={['admin']}>
      <AdminShell>{children}</AdminShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
