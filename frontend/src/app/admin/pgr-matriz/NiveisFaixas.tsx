'use client';

import { LIMITE_FAIXAS, LIMITE_NIVEIS, faixaVazia, nivelVazio, type FormMatriz } from './tipos';
import type { Mudar } from './Escalas';

export function NiveisEditor({ niveis, mudar, bloqueado }: { niveis: FormMatriz['niveis']; mudar: Mudar; bloqueado: boolean }) {
  const alterar = (i: number, patch: Partial<FormMatriz['niveis'][number]>) =>
    mudar((f) => ({ ...f, niveis: f.niveis.map((n, k) => (k === i ? { ...n, ...patch } : n)) }));
  return (
    <fieldset className="min-w-0" disabled={bloqueado}>
      <legend className="text-sm font-semibold text-brand-900">Níveis de risco</legend>
      {niveis.length === 0 && <p className="mt-2 text-sm text-brand-700">Nenhum nível informado.</p>}
      {niveis.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Id</th><th scope="col">Rótulo</th><th scope="col">Aceitabilidade</th><th scope="col">Decisão</th>
                <th scope="col">Bloqueia emissão</th><th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {niveis.map((n, i) => (
                <tr key={n.k}>
                  <td><input aria-label={`Nível ${i + 1}: id`} type="text" className="adm-input w-32" value={n.id} onChange={(e) => alterar(i, { id: e.target.value })} /></td>
                  <td><input aria-label={`Nível ${i + 1}: rótulo`} type="text" className="adm-input w-full min-w-36" value={n.rotulo} onChange={(e) => alterar(i, { rotulo: e.target.value })} /></td>
                  <td><input aria-label={`Nível ${i + 1}: aceitabilidade`} type="text" className="adm-input w-full min-w-40" value={n.aceitabilidade} onChange={(e) => alterar(i, { aceitabilidade: e.target.value })} /></td>
                  <td><input aria-label={`Nível ${i + 1}: decisão`} type="text" className="adm-input w-full min-w-40" value={n.decisao} onChange={(e) => alterar(i, { decisao: e.target.value })} /></td>
                  <td>
                    <select aria-label={`Nível ${i + 1}: bloqueia emissão`} className="adm-input" value={n.bloqueia}
                      onChange={(e) => alterar(i, { bloqueia: e.target.value as '' | 'sim' | 'nao' })}>
                      <option value="">Não informado</option>
                      <option value="sim">Sim</option>
                      <option value="nao">Não</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" className="adm-link-danger whitespace-nowrap" aria-label={`Remover nível ${i + 1}`}
                      onClick={() => mudar((f) => ({ ...f, niveis: f.niveis.filter((_, k) => k !== i) }))}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="adm-btn mt-2 disabled:opacity-50" disabled={niveis.length >= LIMITE_NIVEIS}
        onClick={() => mudar((f) => ({ ...f, niveis: [...f.niveis, nivelVazio()] }))}>
        Adicionar nível
      </button>
    </fieldset>
  );
}

export function FaixasEditor({ faixas, niveis, mudar, bloqueado }: {
  faixas: FormMatriz['faixas']; niveis: FormMatriz['niveis']; mudar: Mudar; bloqueado: boolean;
}) {
  const alterar = (i: number, patch: Partial<FormMatriz['faixas'][number]>) =>
    mudar((f) => ({ ...f, faixas: f.faixas.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const ids = niveis.map((n) => n.id).filter((id) => id.trim() !== '');
  return (
    <fieldset className="min-w-0" disabled={bloqueado}>
      <legend className="text-sm font-semibold text-brand-900">Faixas de escore (severidade × probabilidade)</legend>
      <datalist id="pgr-niveis-ids">{ids.map((id) => <option key={id} value={id} />)}</datalist>
      {faixas.length === 0 && <p className="mt-2 text-sm text-brand-700">Nenhuma faixa informada.</p>}
      {faixas.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="adm-table">
            <thead>
              <tr><th scope="col">Mínimo</th><th scope="col">Máximo</th><th scope="col">Id do nível</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              {faixas.map((x, i) => (
                <tr key={x.k}>
                  <td><input aria-label={`Faixa ${i + 1}: mínimo`} type="number" inputMode="numeric" step={1} className="adm-input w-24" value={x.min} onChange={(e) => alterar(i, { min: e.target.value })} /></td>
                  <td><input aria-label={`Faixa ${i + 1}: máximo`} type="number" inputMode="numeric" step={1} className="adm-input w-24" value={x.max} onChange={(e) => alterar(i, { max: e.target.value })} /></td>
                  <td><input aria-label={`Faixa ${i + 1}: nível`} type="text" list="pgr-niveis-ids" className="adm-input w-40" value={x.nivel_id} onChange={(e) => alterar(i, { nivel_id: e.target.value })} /></td>
                  <td>
                    <button type="button" className="adm-link-danger whitespace-nowrap" aria-label={`Remover faixa ${i + 1}`}
                      onClick={() => mudar((f) => ({ ...f, faixas: f.faixas.filter((_, k) => k !== i) }))}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="adm-btn mt-2 disabled:opacity-50" disabled={faixas.length >= LIMITE_FAIXAS}
        onClick={() => mudar((f) => ({ ...f, faixas: [...f.faixas, faixaVazia()] }))}>
        Adicionar faixa
      </button>
    </fieldset>
  );
}
