'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EpiTabs } from '@/components/epi/EpiTabs';
import { EpiDashboardView, type EpiTabId } from '@/components/epi/EpiDashboardView';
import { EpiCadastroView } from '@/components/epi/EpiCadastroView';
import { EpiMovimentacaoView } from '@/components/epi/EpiMovimentacaoView';
import { EpiFichasView } from '@/components/epi/EpiFichasView';
import { SignatureLinkDialog } from '@/components/epi/SignatureLinkDialog';
import { InPersonDialog } from '@/components/epi/InPersonDialog';

const TABS: Array<{ id: EpiTabId; label: string }> = [
  { id: 'painel', label: 'Painel' },
  { id: 'cadastro', label: 'Cadastro' },
  { id: 'movimentacao', label: 'Movimentação' },
  { id: 'fichas', label: 'Fichas' },
];
const ID = 'tec-epi';

// O papel (técnico/parceiro) é conferido pelo layout; as permissões reais são do backend. Aqui as ações exclusivas da
// empresa (dias de aviso, abertura, ajuste e estorno) ficam desligadas de forma explícita, sem depender do papel lido no cliente.
export default function TecnicoEmpresaEpiPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  // Trocar de empresa remonta tudo: aba, diálogo de link e contador de recarga voltam ao início.
  return <TecnicoEpiInner key={tenantId} tenantId={tenantId} />;
}

function TecnicoEpiInner({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<EpiTabId>('painel');
  const [refresh, setRefresh] = useState(0);
  const [person, setPerson] = useState<string | null>(null);
  const [link, setLink] = useState<{ deliveryId: string; employeeId: string } | null>(null);

  return (
    <div className="px-4 py-8 sm:px-8">
      <Link href={`/tecnico/empresas/${tenantId}`} className="inline-flex min-h-[44px] items-center text-base font-medium text-dash-primary underline">
        Voltar para a empresa
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-dash-primary">EPI da empresa</h1>
      <div className="mt-4">
        <EpiTabs tabs={TABS} value={tab} onChange={(id) => setTab(id as EpiTabId)} ariaLabel="Módulo de EPI" idPrefix={ID} />
      </div>
      <div role="tabpanel" id={`${ID}-panel-${tab}`} aria-labelledby={`${ID}-tab-${tab}`} tabIndex={0} className="mt-6 focus-visible:outline-none">
        {tab === 'painel' && (
          <EpiDashboardView
            tenantId={tenantId}
            canEditSettings={false}
            onNavigate={setTab}
            refreshKey={refresh}
            onPresencial={setPerson}
            onGerarLink={(deliveryId, employeeId) => setLink({ deliveryId, employeeId })}
          />
        )}
        {tab === 'cadastro' && <EpiCadastroView tenantId={tenantId} canManageStock={false} />}
        {tab === 'movimentacao' && <EpiMovimentacaoView tenantId={tenantId} canManageStock={false} />}
        {tab === 'fichas' && <EpiFichasView tenantId={tenantId} />}
      </div>
      <SignatureLinkDialog
        open={link !== null}
        tenantId={tenantId}
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
    </div>
  );
}
