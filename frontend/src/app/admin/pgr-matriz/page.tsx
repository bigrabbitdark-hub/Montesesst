'use client';

import { useState } from 'react';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { CardError, CardSkeleton } from '@/components/admin/Card';
import { ERRO_CARREGAR_PADRAO, useAdminFetch } from '@/components/admin/useAdminFetch';
import { Detalhe } from './Detalhe';
import { ListaVersoes } from './Lista';
import { BASE_MATRIZ, type VersaoResumo } from './tipos';

// /admin/pgr-matriz — matriz de risco do PGR (global da Montese), versionada. O admin cria rascunhos,
// preenche, valida, publica (imutável) e arquiva. A matriz nasce vazia: nada vem preenchido por padrão.
// A autoridade é o backend (rotas somente admin; validação, hash e imutabilidade no servidor).
export default function AdminPgrMatrizPage() {
  const [chave, setChave] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const lista = useAdminFetch<VersaoResumo[]>(BASE_MATRIZ, chave);
  const recarregar = () => setChave((k) => k + 1);

  return (
    <div>
      <AdminPageHeader
        title="PGR — Matriz de risco"
        description="Escalas, níveis e faixas usados para classificar os riscos do PGR. Cada versão publicada é imutável e identificada por hash."
      />
      {lista.data ? (
        <ListaVersoes
          versoes={lista.data}
          selecionada={aberta}
          onAbrir={(id) => { setAviso(''); setAberta(id); }}
          onCriada={(id) => { setAviso('Rascunho criado.'); setAberta(id); recarregar(); }}
        />
      ) : lista.error ? (
        <div className="mt-6"><CardError onRetry={lista.reload} message={lista.error === ERRO_CARREGAR_PADRAO ? 'Não foi possível carregar as versões da matriz.' : lista.error} /></div>
      ) : (
        <div className="mt-6"><CardSkeleton rows={3} /></div>
      )}
      {aviso && <p role="status" className="mt-4 text-sm text-adm-status-ok-text">{aviso}</p>}
      {aberta && (
        <div className="mt-6">
          <Detalhe
            key={aberta}
            id={aberta}
            refreshKey={chave}
            onDuplicada={(id) => { setAviso('Rascunho criado.'); setAberta(id); recarregar(); }}
            onMudou={recarregar}
          />
        </div>
      )}
    </div>
  );
}
