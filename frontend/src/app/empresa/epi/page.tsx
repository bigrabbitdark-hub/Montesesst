'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EpiDashboardView } from '@/components/epi/EpiDashboardView';
import { SignatureLinkDialog } from '@/components/epi/SignatureLinkDialog';
import { InPersonDialog } from '@/components/epi/InPersonDialog';

export default function EmpresaEpiPainelPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [person, setPerson] = useState<string | null>(null);
  const [link, setLink] = useState<{ deliveryId: string; employeeId: string } | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div role="status" className="px-4 py-16 text-center text-base text-dash-muted">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader titulo="Painel de EPI" descricao="Estoque, validade dos CA e entregas aguardando assinatura da sua empresa." />
      <DashSkin>
        <EpiDashboardView refreshKey={refresh} onPresencial={setPerson} onGerarLink={(deliveryId, employeeId) => setLink({ deliveryId, employeeId })} />
        <SignatureLinkDialog
          open={link !== null}
          employeeId={link?.employeeId ?? ''}
          deliveryIds={link ? [link.deliveryId] : undefined}
          onClose={(changed) => { setLink(null); if (changed) setRefresh((n) => n + 1); }}
        />
        <InPersonDialog
          open={person !== null}
          deliveryIds={person ? [person] : []}
          onClose={() => setPerson(null)}
          onDone={() => setRefresh((n) => n + 1)}
        />
      </DashSkin>
    </div>
  );
}
