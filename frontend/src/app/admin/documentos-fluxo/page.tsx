'use client';

import { useState } from 'react';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Card } from '@/components/admin/Card';
import { useAdminFetch } from '@/components/admin/useAdminFetch';
import { ListaViabilidade } from './Viabilidade';
import { MatrizResponsabilidades } from './Matriz';
import { RegistrosProfissionais } from './Registros';
import { AVISO_COMPETENCIA, BASE_DOCUMENTOS, type Socio, type Viabilidade } from './tipos';

// /admin/documentos-fluxo — quem pode elaborar/revisar/aprovar/assinar/publicar cada tipo de documento
// e os registros profissionais dos sócios. O admin só CONFIGURA aqui; não executa nenhuma ação do fluxo.
// A autoridade é o backend (rotas somente admin); esta tela apenas apresenta e envia.
export default function AdminDocumentosFluxoPage() {
  const [viabKey, setViabKey] = useState(0);
  const viabilidade = useAdminFetch<Viabilidade[]>(`${BASE_DOCUMENTOS}/viabilidade`, viabKey);
  const socios = useAdminFetch<Socio[]>(`${BASE_DOCUMENTOS}/socios`);
  const recarregarViabilidade = () => setViabKey((k) => k + 1);

  return (
    <div>
      <AdminPageHeader
        title="Documentos — responsabilidades"
        description="Defina quais sócios podem executar cada etapa por tipo de documento e mantenha os registros profissionais usados na assinatura."
      />
      <p className="adm-card-2 mt-4 px-4 py-3 text-sm font-medium text-brand-900">{AVISO_COMPETENCIA}</p>

      <Card
        id="viabilidade"
        title="Viabilidade por tipo de documento"
        subtitle="Verificação informativa: não impede salvar, mas mostra o que ainda impediria o fluxo."
        className="mt-6"
      >
        <ListaViabilidade estado={viabilidade} />
      </Card>

      <Card
        id="matriz"
        title="Responsabilidades por tipo de documento"
        subtitle="Marque as ações de cada sócio e salve por linha."
        className="mt-6"
      >
        <MatrizResponsabilidades socios={socios} onSalvo={recarregarViabilidade} />
      </Card>

      <Card
        id="registros"
        title="Registros profissionais"
        subtitle="A assinatura exige registro confirmado. Revogar não apaga assinaturas já feitas."
        className="mt-6"
      >
        <RegistrosProfissionais socios={socios} onMudouViabilidade={recarregarViabilidade} />
      </Card>
    </div>
  );
}
