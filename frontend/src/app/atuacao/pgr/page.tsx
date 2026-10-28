'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EmBreveCard } from '@/components/dashboard/EmBreveCard';
import { Card } from '@/components/ui/Card';
import {
  atuacaoFetch, CHAVE_ULTIMA_EMPRESA, MSG_403, MSG_PGR_LEITURA, PGR_PENDENCIA_LABEL, type ClienteResumo, type PgrResumo,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';

const EM_BREVE = [
  ['Matriz de riscos', 'Classificação dos riscos de cada GHE por probabilidade e severidade.'],
  ['Plano de ação', 'Medidas de prevenção com responsável e prazo.'],
  ['Emitir PGR', 'Geração do documento do programa a partir do inventário.'],
  ['Integrações', 'Ligação do inventário com PCMSO, treinamentos e EPI.'],
  ['Tabela 24', 'Tabela de agentes nocivos do eSocial.'],
] as const;

function ultimaEmpresaId(): string {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_ULTIMA_EMPRESA) ?? 'null');
    return v && typeof v.id === 'string' ? v.id : '';
  } catch {
    return '';
  }
}

export default function PgrPage() {
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [resumo, setResumo] = useState<PgrResumo | null>(null);
  const [erroResumo, setErroResumo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let vivo = true;
    atuacaoFetch<ClienteResumo[]>('/clientes')
      .then((d) => {
        if (!vivo) return;
        setClientes(d);
        const ultima = ultimaEmpresaId();
        if (ultima && d.some((c) => c.id === ultima)) setTenantId(ultima);
      })
      .catch((e: Error) => {
        if (vivo) setErroClientes(e.message === MSG_403 ? "Para escolher uma empresa você também precisa da permissão 'Ver clientes'. Peça ao administrador." : e.message);
      });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setResumo(null);
    setErroResumo(null);
    if (!tenantId) { setCarregando(false); return; }
    setCarregando(true);
    atuacaoFetch<PgrResumo>(`/pgr/empresas/${tenantId}/resumo`)
      .then((d) => { if (id === seq.current) setResumo(d); })
      .catch((e: Error) => { if (id === seq.current) setErroResumo(e.message === MSG_403 ? MSG_PGR_LEITURA : e.message); })
      .finally(() => { if (id === seq.current) setCarregando(false); });
  }, [tenantId]);

  const empresa = clientes.find((c) => c.id === tenantId);
  const sufixo = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader
        titulo="PGR — Programa de Gerenciamento de Riscos"
        descricao="Biblioteca de perigos e inventário de riscos das empresas que você atende."
      />
      <div className="mb-6 max-w-xl">
        <label htmlFor="pgr-empresa" className="mb-1 block text-sm font-medium text-dash-muted">Empresa</label>
        <select id="pgr-empresa" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={INPUT}>
          <option value="">Nenhuma empresa selecionada</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {erroClientes && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">{erroClientes}</p>}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card title="Biblioteca de perigos">
          <p className="mt-1 text-sm text-dash-muted">Perigos globais (somente leitura) e personalizados por empresa.</p>
          <p className="mt-3 text-sm"><Link href={`/atuacao/pgr/perigos${sufixo}`} className={LINK}>Biblioteca de perigos</Link></p>
        </Card>
        <Card title={empresa ? empresa.name : 'Empresa'}>
          {!empresa && <p className="mt-1 text-sm text-dash-muted">Escolha uma empresa para ver o andamento do inventário.</p>}
          {empresa && (
            <>
              <p className="mt-3 text-sm"><Link href={`/atuacao/pgr/empresas/${empresa.id}`} className={LINK}>Montar inventário</Link></p>
              <p className="mt-2 text-sm"><Link href={`/atuacao/empresas/${empresa.id}`} className={`${LINK} break-words`}>Abrir {empresa.name}</Link></p>
              {carregando && <p role="status" className="mt-2 text-sm text-dash-muted">Carregando resumo…</p>}
              {erroResumo && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">{erroResumo}</p>}
              {resumo && (
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-dash-muted">GHEs</dt><dd className="font-semibold">{resumo.ghes}</dd></div>
                  <div><dt className="text-xs text-dash-muted">Riscos</dt><dd className="font-semibold">{resumo.riscos}</dd></div>
                  <div><dt className="text-xs text-dash-muted">Completude</dt><dd className="font-semibold">{resumo.completude}%</dd></div>
                  <div className="col-span-3">
                    <dt className="text-xs text-dash-muted">Pendências</dt>
                    <dd>{resumo.pendencias.length ? resumo.pendencias.map((p) => PGR_PENDENCIA_LABEL[p] ?? p).join(', ') : 'Nenhuma'}</dd>
                  </div>
                </dl>
              )}
            </>
          )}
        </Card>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EM_BREVE.map(([t, d]) => <li key={t}><EmBreveCard titulo={t} descricao={d} /></li>)}
      </ul>
    </div>
  );
}
