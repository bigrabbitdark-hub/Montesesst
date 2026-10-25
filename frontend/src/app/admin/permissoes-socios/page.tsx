'use client';

import { useState } from 'react';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { AsyncBody, CardEmpty } from '@/components/admin/Card';
import { useAdminFetch } from '@/components/admin/useAdminFetch';
import { CartaoSocio } from './CartaoSocio';
import { BASE_PERMISSOES, type RespostaPermissoes } from './tipos';

// /admin/permissoes-socios — o admin vê e altera as permissões RBAC dos sócios.
// A autoridade é o backend (rota somente admin); esta tela apenas apresenta e envia.
export default function AdminPermissoesSociosPage() {
  const estado = useAdminFetch<RespostaPermissoes>(BASE_PERMISSOES);
  const [mensagem, setMensagem] = useState('');
  const { reload } = estado;

  return (
    <div>
      <AdminPageHeader
        title="Permissões dos sócios"
        description="Defina o que cada sócio pode ver e fazer no Painel de Atuação. A alteração é registrada na auditoria."
      />
      {mensagem && <p role="status" className="mt-4 text-sm text-adm-status-ok-text">{mensagem}</p>}
      <div className="mt-6">
        <AsyncBody state={estado} rows={4}>
          {(d) =>
            d.socios.length === 0 ? (
              <CardEmpty>Nenhum sócio ativo.</CardEmpty>
            ) : (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {d.socios.map((s) => (
                  // key com as permissões do servidor: após recarregar, o cartão reinicia a partir do estado salvo.
                  <CartaoSocio
                    key={`${s.id}:${s.permissoes.join(',')}`}
                    socio={s}
                    grupos={d.catalogo.grupos}
                    onSalvo={(m) => { setMensagem(m); reload(); }}
                  />
                ))}
              </div>
            )
          }
        </AsyncBody>
      </div>
    </div>
  );
}
