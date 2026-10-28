'use client';

import { useState } from 'react';
import {
  atuacaoFetch, CONTROLE_STATUS, CONTROLE_STATUS_LABEL, CONTROLE_TIPOS, CONTROLE_TIPO_LABEL, EFICACIAS, EFICACIA_LABEL,
  erroEscritaPgr, TREINAMENTO_LABEL, type Risco, type RiscoControle, type RiscoMedicao,
} from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, INPUT, LABEL } from '../../estilos';
import { EpiPicker } from './EpiPicker';

// onRisco recebe uma função (estado anterior => novo), para nunca sobrescrever com um `risco` obsoleto.
type Props = { tenantId: string; risco: Risco; onRisco: (f: (r: Risco) => Risco) => void };

export function ControlesRisco({ tenantId, risco, onRisco }: Props) {
  const [aberto, setAberto] = useState(false);
  const [kind, setKind] = useState('');
  const [descricao, setDescricao] = useState('');
  const [status, setStatus] = useState('');
  const [eficacia, setEficacia] = useState('');
  const [treino, setTreino] = useState('');
  const [epi, setEpi] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (!kind) return setErro('Informe o tipo do controle.');
    if (!descricao.trim()) return setErro('Informe a descrição do controle.');
    if (!status) return setErro('Informe a situação do controle.');
    const body: Record<string, unknown> = { kind, description: descricao.trim(), status };
    if (eficacia) body.effectiveness = eficacia;
    if (kind === 'treinamento' && treino) body.training_tipo = treino;
    if (kind === 'epi' && epi) body.epi_catalog_item_id = epi;
    setOcupado(true); setErro(null);
    try {
      const c = await atuacaoFetch<RiscoControle>(`/pgr/empresas/${tenantId}/riscos/${risco.id}/controles`, { method: 'POST', body: JSON.stringify(body) });
      onRisco((r) => ({ ...r, controles: [...r.controles, c] }));
      setAberto(false); setKind(''); setDescricao(''); setStatus(''); setEficacia(''); setTreino(''); setEpi(null);
    } catch (x) { setErro(erroEscritaPgr(x)); } finally { setOcupado(false); }
  }

  async function remover(c: RiscoControle) {
    setOcupado(true); setErro(null);
    try {
      await atuacaoFetch(`/pgr/empresas/${tenantId}/controles/${c.id}`, { method: 'DELETE' });
      onRisco((r) => ({ ...r, controles: r.controles.filter((x) => x.id !== c.id) }));
    } catch (x) { setErro(erroEscritaPgr(x)); } finally { setOcupado(false); }
  }

  return (
    <section aria-label={`Controles do risco ${risco.name}`} className="mt-3">
      <h5 className="text-sm font-semibold text-dash-primary">Controles</h5>
      {risco.controles.length === 0 && <p className="text-sm text-dash-muted">Nenhum controle informado.</p>}
      <ul className="mt-1 divide-y divide-slate-100 text-sm">
        {risco.controles.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <div>
              <span className="font-medium">{CONTROLE_TIPO_LABEL[c.kind] ?? c.kind}: </span><span>{c.description}</span>
              <p className="text-xs text-dash-muted">
                Situação: {CONTROLE_STATUS_LABEL[c.status] ?? c.status} · Eficácia: {c.effectiveness ? (EFICACIA_LABEL[c.effectiveness] ?? c.effectiveness) : 'não informada'}
                {c.training_tipo ? ` · ${TREINAMENTO_LABEL[c.training_tipo] ?? c.training_tipo}` : ''}
              </p>
            </div>
            <button type="button" className={BTN} disabled={ocupado} onClick={() => remover(c)} aria-label={`Excluir controle ${c.description}`}>Excluir</button>
          </li>
        ))}
      </ul>
      {!aberto && <button type="button" className={`mt-2 ${BTN}`} onClick={() => setAberto(true)}>Adicionar controle</button>}
      {aberto && (
        <form onSubmit={salvar} aria-label="Novo controle" className="mt-2 grid gap-3 rounded-md border border-dash-border-input p-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`ct-tipo-${risco.id}`} className={LABEL}>Tipo de controle</label>
            <select id={`ct-tipo-${risco.id}`} value={kind} onChange={(e) => { setKind(e.target.value); setEpi(null); }} className={INPUT}>
              <option value="">Selecione</option>
              {CONTROLE_TIPOS.map((k) => <option key={k} value={k}>{CONTROLE_TIPO_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`ct-status-${risco.id}`} className={LABEL}>Situação do controle</label>
            <select id={`ct-status-${risco.id}`} value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
              <option value="">Selecione</option>
              {CONTROLE_STATUS.map((k) => <option key={k} value={k}>{CONTROLE_STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`ct-desc-${risco.id}`} className={LABEL}>Descrição do controle</label>
            <textarea id={`ct-desc-${risco.id}`} rows={2} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={INPUT} />
          </div>
          {kind === 'epi' && (
            <div className="sm:col-span-2">
              <EpiPicker escolhido={epi} onEscolher={(item) => { setEpi(item ? item.id : null); if (item && !descricao.trim()) setDescricao(item.description.slice(0, 2000)); }} />
            </div>
          )}
          <div>
            <label htmlFor={`ct-efic-${risco.id}`} className={LABEL}>Eficácia</label>
            <select id={`ct-efic-${risco.id}`} value={eficacia} onChange={(e) => setEficacia(e.target.value)} className={INPUT}>
              <option value="">Não informada</option>
              {EFICACIAS.map((k) => <option key={k} value={k}>{EFICACIA_LABEL[k]}</option>)}
            </select>
          </div>
          {kind === 'treinamento' && (
            <div>
              <label htmlFor={`ct-trein-${risco.id}`} className={LABEL}>Treinamento</label>
              <select id={`ct-trein-${risco.id}`} value={treino} onChange={(e) => setTreino(e.target.value)} className={INPUT}>
                <option value="">Não informado</option>
                {Object.entries(TREINAMENTO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={ocupado} className={BTN_PRIMARY}>{ocupado ? 'Salvando…' : 'Salvar controle'}</button>
            <button type="button" disabled={ocupado} className={BTN} onClick={() => { setAberto(false); setErro(null); }}>Cancelar</button>
          </div>
        </form>
      )}
      {erro && <p role="alert" className={`mt-2 ${ERRO}`}>{erro}</p>}
    </section>
  );
}

// Limites iguais aos do DTO de medição do backend.
const MED_CAMPOS = [
  ['agent', 'Agente medido', 200], ['value', 'Valor medido', 500], ['unit', 'Unidade da medição', 100],
  ['tolerance_limit', 'Limite de tolerância da medição', 500], ['reference', 'Referência da medição', 500],
  ['methodology', 'Metodologia', 500], ['equipment', 'Equipamento', 200],
] as const;

// Medições só existem para avaliação quantitativa (o servidor também recusa nos demais casos). Valor e unidade são texto livre.
export function MedicoesRisco({ tenantId, risco, onRisco }: Props) {
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [data, setData] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (risco.assessment_type !== 'quantitativa') {
    return (
      <section aria-label={`Medições do risco ${risco.name}`} className="mt-3">
        <h5 className="text-sm font-semibold text-dash-primary">Medições</h5>
        <p className="text-sm text-dash-muted">Medições só se aplicam a avaliação quantitativa. Defina o tipo de avaliação do risco para registrá-las.</p>
      </section>
    );
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (!(v.agent ?? '').trim()) return setErro('Informe o agente medido.');
    const body: Record<string, unknown> = {};
    for (const [k] of MED_CAMPOS) if ((v[k] ?? '').trim()) body[k] = v[k].trim();
    if (data) body.evaluated_on = data;
    setOcupado(true); setErro(null);
    try {
      const m = await atuacaoFetch<RiscoMedicao>(`/pgr/empresas/${tenantId}/riscos/${risco.id}/medicoes`, { method: 'POST', body: JSON.stringify(body) });
      onRisco((r) => ({ ...r, medicoes: [...r.medicoes, m] }));
      setAberto(false); setV({}); setData('');
    } catch (x) { setErro(erroEscritaPgr(x)); } finally { setOcupado(false); }
  }

  async function remover(m: RiscoMedicao) {
    setOcupado(true); setErro(null);
    try {
      await atuacaoFetch(`/pgr/empresas/${tenantId}/medicoes/${m.id}`, { method: 'DELETE' });
      onRisco((r) => ({ ...r, medicoes: r.medicoes.filter((x) => x.id !== m.id) }));
    } catch (x) { setErro(erroEscritaPgr(x)); } finally { setOcupado(false); }
  }

  return (
    <section aria-label={`Medições do risco ${risco.name}`} className="mt-3">
      <h5 className="text-sm font-semibold text-dash-primary">Medições</h5>
      {risco.medicoes.length === 0 && <p className="text-sm text-dash-muted">Nenhuma medição informada.</p>}
      <ul className="mt-1 divide-y divide-slate-100 text-sm">
        {risco.medicoes.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>{m.agent}: {m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ''}` : 'valor não informado'}</span>
            <button type="button" className={BTN} disabled={ocupado} onClick={() => remover(m)} aria-label={`Excluir medição ${m.agent}`}>Excluir</button>
          </li>
        ))}
      </ul>
      {!aberto && <button type="button" className={`mt-2 ${BTN}`} onClick={() => setAberto(true)}>Adicionar medição</button>}
      {aberto && (
        <form onSubmit={salvar} aria-label="Nova medição" className="mt-2 grid gap-3 rounded-md border border-dash-border-input p-3 sm:grid-cols-2">
          {MED_CAMPOS.map(([k, r, max]) => (
            <div key={k}>
              <label htmlFor={`md-${k}-${risco.id}`} className={LABEL}>{r}</label>
              <input id={`md-${k}-${risco.id}`} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} className={INPUT} maxLength={max} />
            </div>
          ))}
          <div>
            <label htmlFor={`md-data-${risco.id}`} className={LABEL}>Data da avaliação</label>
            <input id={`md-data-${risco.id}`} type="date" value={data} onChange={(e) => setData(e.target.value)} className={INPUT} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={ocupado} className={BTN_PRIMARY}>{ocupado ? 'Salvando…' : 'Salvar medição'}</button>
            <button type="button" disabled={ocupado} className={BTN} onClick={() => { setAberto(false); setErro(null); }}>Cancelar</button>
          </div>
        </form>
      )}
      {erro && <p role="alert" className={`mt-2 ${ERRO}`}>{erro}</p>}
    </section>
  );
}
