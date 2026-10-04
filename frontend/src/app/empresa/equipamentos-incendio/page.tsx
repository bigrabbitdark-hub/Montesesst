'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FireSafetyEquipmentPanel } from '@/components/FireSafetyEquipmentPanel';
import { Card } from '@/components/ui/Card';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EmpresaEquipamentosIncendioPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div role="status" className="px-4 py-16 text-center text-sm text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader titulo="Equipamentos contra incêndio" />
      <DashSkin>
        <Card>
          <FireSafetyEquipmentPanel />
        </Card>
      </DashSkin>
    </div>
  );
}
