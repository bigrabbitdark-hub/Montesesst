'use client';

import { useState } from 'react';
import { CatPanel } from '@/components/esocial/CatPanel';
import { EsocialPanel } from '@/components/esocial/EsocialPanel';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { PageHeader } from '@/components/dashboard/PageHeader';

// O RoleGuard do layout /empresa já exige login com papel "empresa".
export default function EmpresaEsocialPage() {
  // Quando a CAT gera um evento, a lista de eventos do painel acima recarrega.
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <PageHeader titulo="eSocial: SST (S-2220, S-2210 e S-3000)" />
      <DashSkin>
        <EsocialPanel refreshKey={refreshKey} />
        <div className="mt-6">
          <CatPanel onEventCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
      </DashSkin>
    </div>
  );
}
