'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ghe } from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, INPUT, LABEL, PAINEL } from '../../estilos';

export type Unidade = { id: string; name: string };
const TEXTOS = [
  ['environment_description', 'Descrição do ambiente'],
  ['process_description', 'Processo'],
  ['activities', 'Atividades'],
  ['machines_products', 'Máquinas e produtos'],
  ['notes', 'Observações'],
] as const;
type Campo = (typeof TEXTOS)[number][0];

// Criação: envia só o que foi preenchido. Edição: envia só o que mudou (texto limpo vira null).
export function montarPayloadGhe(v: { name: string; unit: string; textos: Record<Campo, string> }, inicial: Ghe | null): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const nome = v.name.trim();
  if (!inicial || nome !== inicial.name) p.name = nome;
  if (!inicial) { if (v.unit) p.company_unit_id = v.unit; } else if (v.unit !== (inicial.company_unit_id ?? '')) p.company_unit_id = v.unit || null;
  for (const [k] of TEXTOS) {
    const novo = v.textos[k].trim();
    const antigo = (inicial?.[k] ?? '').trim();
    if (!inicial) { if (novo) p[k] = novo; } else if (novo !== antigo) p[k] = novo || null;
  }
  return p;
}

export function GheForm({ inicial, unidades, salvando, erro, onSalvar, onCancelar }: {
  inicial: Ghe | null; unidades: Unidade[]; salvando: boolean; erro: string | null;
  onSalvar: (payload: Record<string, unknown>) => void; onCancelar: () => void;
}) {
  const [name, setName] = useState(inicial?.name ?? '');
  const [unit, setUnit] = useState(inicial?.company_unit_id ?? '');
  const [textos, setTextos] = useState<Record<Campo, string>>(() => {
    const t = {} as Record<Campo, string>;
    for (const [k] of TEXTOS) t[k] = inicial?.[k] ?? '';
    return t;
  });
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titulo.current?.focus(); }, []);
  const rotulo = inicial ? `Editar GHE: ${inicial.name}` : 'Novo ambiente (GHE)';
  return (
    <form
      aria-label={rotulo}
      className={`mb-4 ${PAINEL}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (salvando) return;
        if (!name.trim()) { setErroLocal('Informe o nome do GHE.'); return; }
        const payload = montarPayloadGhe({ name, unit, textos }, inicial);
        if (!Object.keys(payload).length) { setErroLocal('Nenhuma alteração para salvar.'); return; }
        setErroLocal(null);
        onSalvar(payload);
      }}
    >
      <h4 ref={titulo} tabIndex={-1} className="mb-3 text-base font-semibold text-dash-primary focus:outline-none">{rotulo}</h4>
      <fieldset disabled={salvando} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ghe-nome" className={LABEL}>Nome do GHE</label>
          <input id="ghe-nome" aria-required="true" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ghe-unidade" className={LABEL}>Unidade</label>
          <select id="ghe-unidade" value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT}>
            <option value="">Não informada</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {TEXTOS.map(([k, r]) => (
          <div key={k} className="sm:col-span-2">
            <label htmlFor={`ghe-${k}`} className={LABEL}>{r}</label>
            <textarea id={`ghe-${k}`} rows={2} maxLength={4000} value={textos[k]} onChange={(e) => setTextos({ ...textos, [k]: e.target.value })} className={INPUT} />
          </div>
        ))}
      </fieldset>
      {(erroLocal || erro) && <p role="alert" className={`mt-3 ${ERRO}`}>{erroLocal ?? erro}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={salvando} className={BTN_PRIMARY}>{salvando ? 'Salvando…' : 'Salvar GHE'}</button>
        <button type="button" onClick={onCancelar} disabled={salvando} className={BTN}>Cancelar</button>
      </div>
    </form>
  );
}
