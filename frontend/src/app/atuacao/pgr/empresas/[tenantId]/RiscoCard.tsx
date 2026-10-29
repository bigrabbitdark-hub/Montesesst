'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, avaliacaoLabel, erroEscritaPgr, exposicaoLabel, EXPOSICAO_LABEL, PERIGO_AVALIACAO_LABEL, PERIGO_CATEGORIAS,
  PERIGO_CATEGORIA_LABEL, perigoCategoriaLabel, RISCO_STATUS_LABEL, type Risco,
} from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, INPUT, LABEL } from '../../estilos';
import { AvaliacaoRisco } from './AvaliacaoRisco';
import type { MatrizCtx } from './useMatrizVigente';
import { ControlesRisco, MedicoesRisco } from './RiscoSecoes';

const TEXTOS = [
  ['description', 'Descrição', true, 4000], ['sources', 'Fontes geradoras', true, 4000], ['health_effects', 'Efeitos à saúde', true, 4000],
  ['activity', 'Atividade', true, 4000], ['assessment_notes', 'Observações da avaliação', true, 4000],
  ['tolerance_limit', 'Limite de tolerância', false, 500], ['tolerance_reference', 'Referência do limite', false, 500], ['esocial_code', 'Código eSocial', false, 20],
] as const;

type Valores = Record<string, string>;
function iniciais(r: Risco): Valores {
  const v: Valores = {
    name: r.name, category: r.category, exposure_type: r.exposure_type ?? '', assessment_type: r.assessment_type ?? '', status: r.status,
  };
  for (const [k] of TEXTOS) v[k] = (r[k] as string | null) ?? '';
  return v;
}

// Envia só o que mudou; texto limpo vira null (o servidor valida o que é obrigatório).
export function diffRisco(r: Risco, v: Valores): Record<string, unknown> {
  const antes = iniciais(r);
  const p: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const novo = k === 'name' ? v[k].trim() : v[k];
    if (novo === antes[k] || (k !== 'name' && k !== 'category' && k !== 'status' && novo.trim() === antes[k].trim())) continue;
    p[k] = ['name', 'category', 'status'].includes(k) ? novo : (novo.trim() === '' ? null : novo.trim());
  }
  return p;
}

function EditarRisco({ risco, tenantId, onRisco, onFechar }: { risco: Risco; tenantId: string; onRisco: (r: Risco) => void; onFechar: () => void }) {
  const [v, setV] = useState<Valores>(() => iniciais(risco));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: string, val: string) => setV({ ...v, [k]: val });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (!v.name.trim()) return setErro('Informe o nome do risco.');
    const body = diffRisco(risco, v);
    if (!Object.keys(body).length) return setErro('Nenhuma alteração para salvar.');
    setOcupado(true); setErro(null);
    try {
      const salvo = await atuacaoFetch<Risco>(`/pgr/empresas/${tenantId}/riscos/${risco.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onRisco(salvo);
      onFechar();
    } catch (x) { setErro(erroEscritaPgr(x)); } finally { setOcupado(false); }
  }

  const id = (k: string) => `rk-${k}-${risco.id}`;
  return (
    <form onSubmit={salvar} aria-label={`Editar risco: ${risco.name}`} className="mt-3 grid gap-3 rounded-md border border-dash-border-input p-3 sm:grid-cols-2">
      <div>
        <label htmlFor={id('name')} className={LABEL}>Nome do risco</label>
        <input id={id('name')} maxLength={200} value={v.name} onChange={(e) => set('name', e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor={id('category')} className={LABEL}>Categoria do risco</label>
        <select id={id('category')} value={v.category} onChange={(e) => set('category', e.target.value)} className={INPUT}>
          {PERIGO_CATEGORIAS.map((c) => <option key={c} value={c}>{PERIGO_CATEGORIA_LABEL[c]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={id('exposure_type')} className={LABEL}>Tipo de exposição</label>
        <select id={id('exposure_type')} value={v.exposure_type} onChange={(e) => set('exposure_type', e.target.value)} className={INPUT}>
          <option value="">Não informado</option>
          {Object.entries(EXPOSICAO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={id('assessment_type')} className={LABEL}>Tipo de avaliação</label>
        <select id={id('assessment_type')} value={v.assessment_type} onChange={(e) => set('assessment_type', e.target.value)} className={INPUT}>
          <option value="">Não informado</option>
          {Object.entries(PERIGO_AVALIACAO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {TEXTOS.map(([k, r, longo, max]) => (
        <div key={k} className={longo ? 'sm:col-span-2' : ''}>
          <label htmlFor={id(k)} className={LABEL}>{r}</label>
          {longo
            ? <textarea id={id(k)} rows={2} maxLength={max} value={v[k]} onChange={(e) => set(k, e.target.value)} className={INPUT} />
            : <input id={id(k)} maxLength={max} value={v[k]} onChange={(e) => set(k, e.target.value)} className={INPUT} />}
        </div>
      ))}
      <div>
        <label htmlFor={id('status')} className={LABEL}>Situação do risco</label>
        <select id={id('status')} value={v.status} onChange={(e) => set('status', e.target.value)} className={INPUT}>
          {Object.entries(RISCO_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <p className="mt-1 text-xs text-dash-muted">“Completo” exige tipo de exposição e tipo de avaliação.</p>
      </div>
      {erro && <p role="alert" className={`sm:col-span-2 ${ERRO}`}>{erro}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={ocupado} className={BTN_PRIMARY}>{ocupado ? 'Salvando…' : 'Salvar risco'}</button>
        <button type="button" disabled={ocupado} className={BTN} onClick={onFechar}>Cancelar</button>
      </div>
    </form>
  );
}

export function RiscoCard({ risco, tenantId, matriz, onRisco, onExcluido }: {
  risco: Risco; tenantId: string; matriz: MatrizCtx; onRisco: (f: (r: Risco) => Risco) => void; onExcluido: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir() {
    setOcupado(true); setErro(null);
    try {
      await atuacaoFetch(`/pgr/empresas/${tenantId}/riscos/${risco.id}`, { method: 'DELETE' });
      onExcluido(risco.id);
    } catch (x) { setErro(erroEscritaPgr(x)); setOcupado(false); setConfirmando(false); }
  }

  return (
    <article aria-label={`Risco: ${risco.name}`} className="rounded-md border border-dash-border-input p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-dash-primary">{risco.name}</h4>
        <Badge tone={risco.status === 'completo' ? 'ok' : 'warn'}>{RISCO_STATUS_LABEL[risco.status] ?? risco.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-dash-muted">
        {perigoCategoriaLabel(risco.category)} · Exposição: {exposicaoLabel(risco.exposure_type)} · Avaliação: {avaliacaoLabel(risco.assessment_type)}
      </p>
      {!editando && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={BTN} disabled={ocupado} onClick={() => setEditando(true)} aria-label={`Editar risco ${risco.name}`}>Editar</button>
          {confirmando ? (
            <>
              <button type="button" className={BTN_PRIMARY} disabled={ocupado} onClick={excluir}>Confirmar exclusão do risco</button>
              <button type="button" className={BTN} disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className={BTN} disabled={ocupado} onClick={() => setConfirmando(true)} aria-label={`Excluir risco ${risco.name}`}>Excluir</button>
          )}
        </div>
      )}
      {editando && <EditarRisco risco={risco} tenantId={tenantId} onRisco={(r) => onRisco(() => r)} onFechar={() => setEditando(false)} />}
      {erro && <p role="alert" className={`mt-2 ${ERRO}`}>{erro}</p>}
      <AvaliacaoRisco risco={risco} tenantId={tenantId} matriz={matriz} />
      <ControlesRisco tenantId={tenantId} risco={risco} onRisco={onRisco} />
      <MedicoesRisco tenantId={tenantId} risco={risco} onRisco={onRisco} />
    </article>
  );
}
