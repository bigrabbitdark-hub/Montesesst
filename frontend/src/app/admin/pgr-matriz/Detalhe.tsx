'use client';

import { CardError, CardSkeleton } from '@/components/admin/Card';
import { ERRO_CARREGAR_PADRAO, useAdminFetch } from '@/components/admin/useAdminFetch';
import { Editor } from './Editor';
import { Leitura } from './Leitura';
import { BASE_MATRIZ, type VersaoDetalhe } from './tipos';

const STATUS_ROTULO = { rascunho: 'Rascunho', publicada: 'Publicada', arquivada: 'Arquivada' } as const;

// Carrega a versão escolhida. Só mostra dados cujo id é o selecionado agora: uma resposta atrasada de outra
// versão (ou o dado antigo mantido durante a recarga) nunca aparece como se fosse a atual.
export function Detalhe({ id, refreshKey, onDuplicada, onMudou }: {
  id: string; refreshKey: number; onDuplicada: (id: string) => void; onMudou: () => void;
}) {
  const estado = useAdminFetch<VersaoDetalhe>(`${BASE_MATRIZ}/${encodeURIComponent(id)}`, refreshKey);
  const versao = estado.data && estado.data.id === id ? estado.data : null;

  return (
    <section aria-labelledby="detalhe-titulo" className="adm-card flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <header>
        <h3 id="detalhe-titulo" className="text-[15px] font-semibold text-brand-900">
          {versao ? `Versão ${versao.version_number} — ${STATUS_ROTULO[versao.status]}` : 'Versão selecionada'}
        </h3>
      </header>
      {estado.error && !estado.loading ? (
        <CardError onRetry={estado.reload} message={estado.error === ERRO_CARREGAR_PADRAO ? 'Não foi possível carregar a versão.' : estado.error} />
      ) : versao ? (
        versao.status === 'rascunho'
          ? <Editor key={`${versao.id}:${versao.updated_at}`} versao={versao} onPublicada={onMudou} />
          : <Leitura key={`${versao.id}:${versao.status}`} versao={versao} onDuplicada={onDuplicada} onMudou={onMudou} />
      ) : (
        <CardSkeleton rows={4} />
      )}
    </section>
  );
}
