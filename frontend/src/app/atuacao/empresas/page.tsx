'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { atuacaoFetch, CHAVE_ULTIMA_EMPRESA, formatCnpj, MSG_403, SITUACAO_LABEL, SITUACAO_TONE, type ClienteResumo } from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';

const MSG_SEM_CLIENTES = "Para escolher uma empresa você também precisa da permissão 'Ver clientes'. Peça ao administrador.";

// Conveniência: a tela funciona igual se o armazenamento do navegador estiver bloqueado.
function lerUltima(): { id: string; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_ULTIMA_EMPRESA) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.name === 'string' ? { id: v.id, name: v.name } : null;
  } catch {
    return null;
  }
}

export default function EmpresasPage() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [data, setData] = useState<ClienteResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ultima, setUltima] = useState<{ id: string; name: string } | null>(null);
  const seq = useRef(0);

  useEffect(() => { setUltima(lerUltima()); }, []);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (buscaAplicada) qs.set('q', buscaAplicada);
    const sufixo = qs.toString();
    atuacaoFetch<ClienteResumo[]>(`/clientes${sufixo ? `?${sufixo}` : ''}`)
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e: Error) => {
        if (id !== seq.current) return;
        // 403 aqui = falta `clients.read` (a lista de empresas vem da carteira de clientes).
        setError(e.message === MSG_403 ? MSG_SEM_CLIENTES : e.message);
      })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [buscaAplicada]);

  useEffect(carregar, [carregar]);

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Empresas" descricao="Escolha a empresa que você vai atender para ver documentos, vencimentos, funcionários e EPI." />
      {ultima && (
        <p className="mb-4 text-sm">
          <Link href={`/atuacao/empresas/${ultima.id}`} className={`${LINK} break-words`}>Continuar com {ultima.name}</Link>
        </p>
      )}
      <div className="mb-4 max-w-xl">
        <label htmlFor="busca-empresa" className="mb-1 block text-sm font-medium text-dash-muted">Buscar empresa</label>
        <input
          id="busca-empresa"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, fantasia ou CNPJ"
          className={INPUT}
        />
      </div>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-48 w-full"
        render={(lista) =>
          lista.length === 0 ? (
            <p className="text-sm text-dash-muted">Nenhuma empresa encontrada.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {lista.map((c) => (
                <li key={c.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/atuacao/empresas/${c.id}`} className={`${LINK} break-words`}>{c.name}</Link>
                    <Badge tone={SITUACAO_TONE[c.situacao]}>{SITUACAO_LABEL[c.situacao]}</Badge>
                  </div>
                  {c.trade_name && <p className="break-words text-xs text-dash-muted">{c.trade_name}</p>}
                  <p className="mt-2 text-sm">{formatCnpj(c.cnpj)}</p>
                </li>
              ))}
            </ul>
          )
        }
      />
    </div>
  );
}
