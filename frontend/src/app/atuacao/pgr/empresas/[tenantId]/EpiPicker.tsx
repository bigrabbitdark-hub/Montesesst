'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { atuacaoFetch, erroLeituraPgr, type EpiCatalogoItem } from '../../../api';
import { BTN, INPUT, LABEL } from '../../estilos';

// Escolha opcional de um item do catálogo de EPI (NR-06). Só descrição/categoria são mostradas: o catálogo não traz CA nem validade.
export function EpiPicker({ escolhido, onEscolher }: { escolhido: string | null; onEscolher: (item: EpiCatalogoItem | null) => void }) {
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [itens, setItens] = useState<EpiCatalogoItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const seq = useRef(0);
  const uid = useId();

  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const id = ++seq.current;
    setErro(null);
    atuacaoFetch<EpiCatalogoItem[]>(`/pgr/epi-catalogo${qAplicada ? `?q=${encodeURIComponent(qAplicada)}` : ''}`)
      .then((d) => { if (id === seq.current) setItens(d); })
      .catch((e) => { if (id === seq.current) { setItens(null); setErro(erroLeituraPgr(e)); } });
  }, [qAplicada]);

  return (
    <fieldset className="rounded-md border border-dash-border-input p-3">
      <legend className="px-1 text-sm font-semibold text-dash-primary">EPI do catálogo (opcional)</legend>
      {escolhido && (
        <p className="mb-2 text-sm" role="status">
          Selecionado: <span className="font-semibold">{nome ?? 'item do catálogo'}</span>{' '}
          <button type="button" className={BTN} onClick={() => { setNome(null); onEscolher(null); }}>Limpar EPI</button>
        </p>
      )}
      <label htmlFor={`${uid}-busca`} className={LABEL}>Buscar EPI no catálogo</label>
      <input id={`${uid}-busca`} value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} className={INPUT} />
      {erro && <p role="alert" className="mt-2 text-sm text-dash-status-crit-text">{erro}</p>}
      {itens !== null && itens.length === 0 && <p className="mt-2 text-sm text-dash-muted">Nenhum EPI encontrado no catálogo.</p>}
      {itens !== null && itens.length > 0 && (
        <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto text-sm">
          {itens.map((i) => (
            <li key={i.id} className="py-1.5">
              <label className="flex items-start gap-2">
                <input
                  type="radio" name={`${uid}-epi`} checked={escolhido === i.id}
                  onChange={() => { setNome(i.description); onEscolher(i); }}
                />
                <span>{i.description} <span className="text-xs text-dash-muted">({i.category} · {i.equipment_group})</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-dash-muted">Sem escolher um item, descreva o EPI no texto do controle.</p>
    </fieldset>
  );
}
