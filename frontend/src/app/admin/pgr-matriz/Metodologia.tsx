'use client';

import { FORMULA_CONHECIDA, type FormMatriz, type FormMetodologia } from './tipos';
import type { Mudar } from './Escalas';

// Metodologia: texto informado por quem validou. Nada é preenchido por padrão; a fórmula só oferece a única conhecida.
export function MetodologiaEditor({ valor, mudar, bloqueado }: { valor: FormMatriz['metodologia']; mudar: Mudar; bloqueado: boolean }) {
  const alterar = (patch: Partial<FormMetodologia>) => mudar((f) => ({ ...f, metodologia: { ...f.metodologia, ...patch } }));
  return (
    <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2" disabled={bloqueado}>
      <legend className="mb-2 text-sm font-semibold text-brand-900">Metodologia</legend>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Fórmula
        <select className="adm-input" value={valor.formula} onChange={(e) => alterar({ formula: e.target.value })}>
          <option value="">Não informada</option>
          <option value={FORMULA_CONHECIDA}>{FORMULA_CONHECIDA}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Validada por
        <input type="text" className="adm-input" value={valor.validada_por} onChange={(e) => alterar({ validada_por: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Registro
        <input type="text" className="adm-input" value={valor.registro} onChange={(e) => alterar({ registro: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Data da validação
        <input type="date" className="adm-input" value={valor.data} onChange={(e) => alterar({ data: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900 sm:col-span-2">
        Observações da metodologia
        <textarea rows={2} className="adm-input" value={valor.observacoes} onChange={(e) => alterar({ observacoes: e.target.value })} />
      </label>
    </fieldset>
  );
}
