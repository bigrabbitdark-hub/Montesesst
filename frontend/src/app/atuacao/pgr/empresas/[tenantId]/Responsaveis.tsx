'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { MSG_REGISTRO_INDISPONIVEL, type Responsavel } from '../../../api';
import { INPUT, LABEL } from '../../estilos';

// Etapa 2. Nenhuma API liberada ao sócio expõe registros profissionais (a listagem é só do admin), então nada é
// consultado nem inventado: cada responsável mostra o texto de indisponível. O representante é apenas campo local.
export function Responsaveis({ responsaveis, carregando, falhou }: { responsaveis: Responsavel[] | null; carregando: boolean; falhou: boolean }) {
  const [representante, setRepresentante] = useState('');
  return (
    <Card title="Responsáveis pelo cliente">
      <h4 className="text-sm font-semibold text-dash-primary">Responsáveis técnicos</h4>
      {carregando && <p role="status" className="mt-2 text-sm text-dash-muted">Carregando responsáveis…</p>}
      {falhou && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">Não foi possível carregar os responsáveis do cliente. Verifique a permissão “Ver clientes” e tente de novo.</p>}
      {!carregando && !falhou && responsaveis === null && <p className="mt-2 text-sm text-dash-muted">Lista de responsáveis não informada pelo cadastro do cliente.</p>}
      {responsaveis !== null && responsaveis.length === 0 && <p className="mt-2 text-sm text-dash-muted">Nenhum responsável vinculado a este cliente.</p>}
      {responsaveis !== null && responsaveis.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {responsaveis.map((r) => (
            <li key={r.id} className="py-2">
              <p className="font-semibold text-dash-primary">{r.full_name}</p>
              <p className="text-dash-muted">{MSG_REGISTRO_INDISPONIVEL}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 max-w-xl">
        <label htmlFor="pgr-representante" className={LABEL}>Representante da empresa</label>
        <input id="pgr-representante" maxLength={200} value={representante} onChange={(e) => setRepresentante(e.target.value)} className={INPUT} />
        <p className="mt-1 text-xs text-dash-muted">
          Este campo não é salvo: o sistema ainda não tem onde guardar esse dado. Serve só de apoio nesta tela e some ao sair dela.
        </p>
      </div>
    </Card>
  );
}
