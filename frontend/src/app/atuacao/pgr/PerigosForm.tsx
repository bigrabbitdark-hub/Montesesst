'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PERIGO_AVALIACAO_LABEL, PERIGO_CATEGORIAS, PERIGO_CATEGORIA_LABEL, PSICO_CAMPOS, type PerigoDetalhe,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:bg-slate-50 disabled:text-dash-muted';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const BTN =
  'rounded-md border border-dash-border-input px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:cursor-not-allowed disabled:opacity-50';

type Texto = 'description' | 'sources' | 'health_effects' | 'default_unit' | 'tolerance_limit' | 'tolerance_reference' | 'suggested_controls' | 'esocial_code';
const TEXTOS: { k: Texto; rotulo: string; longo?: boolean; max: number }[] = [
  { k: 'description', rotulo: 'Descrição', longo: true, max: 4000 },
  { k: 'sources', rotulo: 'Fontes geradoras', longo: true, max: 4000 },
  { k: 'health_effects', rotulo: 'Efeitos à saúde', longo: true, max: 4000 },
  { k: 'suggested_controls', rotulo: 'Controles sugeridos', longo: true, max: 4000 },
  { k: 'tolerance_limit', rotulo: 'Limite de tolerância', max: 500 },
  { k: 'tolerance_reference', rotulo: 'Referência do limite', max: 500 },
  { k: 'default_unit', rotulo: 'Unidade padrão', max: 100 },
  { k: 'esocial_code', rotulo: 'Código eSocial', max: 20 },
];

export type PerigoPayload = Record<string, unknown>;

function vazioParaNulo(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

// Monta o corpo. `completo` (edição) envia null para campo limpo; na criação, campo vazio é omitido.
export function montarPayload(
  v: { category: string; name: string; textos: Record<Texto, string>; vias: string; avaliacao: string; psico: Record<string, string> },
  inicial: PerigoDetalhe | null,
  completo: boolean,
): PerigoPayload {
  const p: PerigoPayload = { category: v.category, name: v.name.trim() };
  for (const { k } of TEXTOS) {
    const val = vazioParaNulo(v.textos[k]);
    if (val !== null || completo) p[k] = val;
  }
  const vias = v.vias.split(',').map((s) => s.trim()).filter(Boolean);
  if (vias.length || completo) p.exposure_routes = vias;
  const aval = v.avaliacao || null;
  if (aval !== null || completo) p.default_assessment = aval;
  if (v.category === 'psicossocial') {
    const obj: Record<string, unknown> = { ...(inicial?.psychosocial ?? {}) };
    for (const [k] of PSICO_CAMPOS) {
      const val = vazioParaNulo(v.psico[k] ?? '');
      if (val === null) delete obj[k]; else obj[k] = val;
    }
    if (Object.keys(obj).length) p.psychosocial = obj;
    else if (completo) p.psychosocial = null;
  } else if (completo && inicial?.psychosocial != null) {
    p.psychosocial = null;
  }
  return p;
}

export function PerigosForm({
  inicial, somenteLeitura, salvando, erro, onSalvar, onCancelar,
}: {
  inicial: PerigoDetalhe | null;
  somenteLeitura: boolean;
  salvando: boolean;
  erro: string | null;
  onSalvar: (payload: PerigoPayload) => void;
  onCancelar: () => void;
}) {
  const [category, setCategory] = useState<string>(inicial?.category ?? 'fisico');
  const [name, setName] = useState(inicial?.name ?? '');
  const [textos, setTextos] = useState<Record<Texto, string>>(() => {
    const t = {} as Record<Texto, string>;
    for (const { k } of TEXTOS) t[k] = inicial?.[k] ?? '';
    return t;
  });
  const [vias, setVias] = useState((inicial?.exposure_routes ?? []).join(', '));
  const [avaliacao, setAvaliacao] = useState(inicial?.default_assessment ?? '');
  const [psico, setPsico] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const [k] of PSICO_CAMPOS) {
      const v = inicial?.psychosocial?.[k];
      o[k] = typeof v === 'string' ? v : '';
    }
    return o;
  });
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titulo.current?.focus(); }, []);

  const rotulo = inicial ? `Perigo: ${inicial.name}` : 'Novo perigo';

  return (
    <form
      aria-label={rotulo}
      onSubmit={(e) => {
        e.preventDefault();
        if (somenteLeitura || salvando) return;
        if (!name.trim()) { setErroLocal('Informe o nome do perigo.'); return; }
        setErroLocal(null);
        onSalvar(montarPayload({ category, name, textos, vias, avaliacao, psico }, inicial, inicial !== null));
      }}
      className="mb-6 rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)] sm:p-6"
    >
      <h2 ref={titulo} tabIndex={-1} className="mb-1 text-base font-semibold text-dash-primary focus:outline-none">{rotulo}</h2>
      {somenteLeitura && (
        <p className="mb-3 text-sm text-dash-muted">
          Somente leitura: perigos globais só podem ser alterados pelo administrador. Para adaptar, duplique para a empresa.
        </p>
      )}
      <fieldset disabled={somenteLeitura || salvando} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pf-categoria" className={LABEL}>Categoria do perigo</label>
          <select id="pf-categoria" value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
            {PERIGO_CATEGORIAS.map((c) => <option key={c} value={c}>{PERIGO_CATEGORIA_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pf-nome" className={LABEL}>Nome</label>
          <input id="pf-nome" aria-required="true" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="pf-avaliacao" className={LABEL}>Avaliação padrão</label>
          <select id="pf-avaliacao" value={avaliacao} onChange={(e) => setAvaliacao(e.target.value)} className={INPUT}>
            <option value="">Não informada</option>
            {Object.entries(PERIGO_AVALIACAO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pf-vias" className={LABEL}>Vias de exposição (separe por vírgula)</label>
          <input id="pf-vias" value={vias} onChange={(e) => setVias(e.target.value)} className={INPUT} />
        </div>
        {TEXTOS.map(({ k, rotulo: r, longo, max }) => (
          <div key={k} className={longo ? 'sm:col-span-2' : ''}>
            <label htmlFor={`pf-${k}`} className={LABEL}>{r}</label>
            {longo ? (
              <textarea id={`pf-${k}`} rows={3} maxLength={max} value={textos[k]} onChange={(e) => setTextos({ ...textos, [k]: e.target.value })} className={INPUT} />
            ) : (
              <input id={`pf-${k}`} maxLength={max} value={textos[k]} onChange={(e) => setTextos({ ...textos, [k]: e.target.value })} className={INPUT} />
            )}
          </div>
        ))}
        {category === 'psicossocial' && (
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-semibold text-dash-primary">Fatores psicossociais</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PSICO_CAMPOS.map(([k, r]) => (
                <div key={k}>
                  <label htmlFor={`pf-psico-${k}`} className={LABEL}>{r}</label>
                  <textarea
                    id={`pf-psico-${k}`} rows={2} value={psico[k]}
                    onChange={(e) => setPsico({ ...psico, [k]: e.target.value })} className={INPUT}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </fieldset>
      {(erroLocal || erro) && <p role="alert" className="mt-3 text-sm text-dash-status-crit-text">{erroLocal ?? erro}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!somenteLeitura && (
          <button type="submit" disabled={salvando} className={`${BTN} bg-dash-primary text-white`}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        )}
        <button type="button" onClick={onCancelar} disabled={salvando} className={BTN}>
          {somenteLeitura ? 'Fechar' : 'Cancelar'}
        </button>
      </div>
    </form>
  );
}
