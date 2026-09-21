import type { ReactNode } from 'react';
import './admin-theme.css';
import { AdminShell } from '@/components/admin/AdminShell';
import { WhatsAppButton } from '@/components/WhatsAppButton';

export const metadata = { title: 'Montese Control — Admin' };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminShell>{children}</AdminShell>
      <WhatsAppButton />
    </>
  );
}
