'use client';

import { useMemo, useState } from 'react';
import { EXPOSICAO_LABEL, MSG_PGR_BIBLIOTECA_VAZIA, perigoCategoriaLabel, type PerigoResumo } from '../../../api';
import { BTN_PRIMARY, INPUT, LABEL } from '../../estilos';

// Seleção de vários perigos da biblioteca para adicionar de uma vez ao GHE. O servidor copia os valores e ignora repetidos.
// O servidor aceita até 100 perigos por requisição.
export const MAX_POR_VEZ = 100;

export function PerigosPicker({ perigos, erro, ocupado, onAdicionar }: {
  perigos: PerigoResumo[] | null; erro: string | null; ocupado: boolean;
  onAdicionar: (ids: string[], exposicao: string) => Promise<boolean>;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [exposicao, setExposicao] = useState('');
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (perigos ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [perigos, busca]);
  return (
    <section aria-labelledby="picker-titulo" className="mt-4 rounded-md border border-dash-border-input p-3">
      <h4 id="picker-titulo" className="text-sm font-semibold text-dash-primary">Adicionar perigos da biblioteca</h4>
      {perigos === null && !erro && <p role="status" className="mt-2 text-sm text-dash-muted">Carregando perigos…</p>}
      {erro && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">{erro}</p>}
      {perigos !== null && perigos.length === 0 && <p className="mt-2 text-sm text-dash-muted">{MSG_PGR_BIBLIOTECA_VAZIA}</p>}
      {perigos !== null && perigos.length > 0 && (
        <>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="picker-busca" className={LABEL}>Buscar perigo</label>
              <input id="picker-busca" value={busca} onChange={(e) => setBusca(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="picker-exposicao" className={LABEL}>Exposição dos riscos adicionados</label>
              <select id="picker-exposicao" value={exposicao} onChange={(e) => setExposicao(e.target.value)} className={INPUT}>
                <option value="">Não informado</option>
                {Object.entries(EXPOSICAO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          {visiveis.length === 0 && <p className="mt-2 text-sm text-dash-muted">Nenhum perigo encontrado com esta busca.</p>}
          <ul className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
            {visiveis.map((p) => (
              <li key={p.id} className="py-1.5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox" checked={sel.includes(p.id)} disabled={ocupado}
                    onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))}
                  />
                  <span>{p.name} ({perigoCategoriaLabel(p.category)})</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button" className={`mt-3 ${BTN_PRIMARY}`} disabled={ocupado || sel.length === 0 || sel.length > MAX_POR_VEZ}
            onClick={async () => { if (await onAdicionar(sel, exposicao)) setSel([]); }}
          >
            {ocupado ? 'Adicionando…' : `Adicionar ao GHE (${sel.length})`}
          </button>
          {sel.length > MAX_POR_VEZ && (
            <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">Máximo de {MAX_POR_VEZ} perigos por vez. Desmarque {sel.length - MAX_POR_VEZ} para continuar.</p>
          )}
        </>
      )}
    </section>
  );
}
