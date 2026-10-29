'use client';

import { LIMITE_ESCALA, escalaVazia, type FormMatriz, type ItemEscala } from './tipos';

export type Mudar = (fn: (f: FormMatriz) => FormMatriz) => void;

// Escala (severidade ou probabilidade): valor, rótulo e descrição. Nenhuma linha vem preenchida; o servidor valida.
export function EscalaEditor({ chave, nome, itens, mudar, bloqueado }: {
  chave: 'severidade' | 'probabilidade'; nome: 'Severidade' | 'Probabilidade'; itens: ItemEscala[]; mudar: Mudar; bloqueado: boolean;
}) {
  const minusculo = nome.toLowerCase();
  const alterar = (i: number, patch: Partial<ItemEscala>) =>
    mudar((f) => ({ ...f, [chave]: f[chave].map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  return (
    <fieldset className="min-w-0" disabled={bloqueado}>
      <legend className="text-sm font-semibold text-brand-900">Escala de {minusculo}</legend>
      {itens.length === 0 && <p className="mt-2 text-sm text-brand-700">Nenhum item informado.</p>}
      {itens.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="adm-table">
            <thead>
              <tr><th scope="col">Valor</th><th scope="col">Rótulo</th><th scope="col">Descrição</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              {itens.map((it, i) => (
                <tr key={it.k}>
                  <td>
                    <input aria-label={`${nome}, item ${i + 1}: valor`} type="number" inputMode="numeric" min={1} step={1} className="adm-input w-24"
                      value={it.valor} onChange={(e) => alterar(i, { valor: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label={`${nome}, item ${i + 1}: rótulo`} type="text" className="adm-input w-full min-w-40"
                      value={it.rotulo} onChange={(e) => alterar(i, { rotulo: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label={`${nome}, item ${i + 1}: descrição`} type="text" className="adm-input w-full min-w-56"
                      value={it.descricao} onChange={(e) => alterar(i, { descricao: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="adm-link-danger whitespace-nowrap" aria-label={`Remover item ${i + 1} de ${minusculo}`}
                      onClick={() => mudar((f) => ({ ...f, [chave]: f[chave].filter((_, k) => k !== i) }))}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="adm-btn mt-2 disabled:opacity-50" disabled={itens.length >= LIMITE_ESCALA}
        onClick={() => mudar((f) => ({ ...f, [chave]: [...f[chave], escalaVazia()] }))}>
        Adicionar item de {minusculo}
      </button>
      {itens.length >= LIMITE_ESCALA && <p className="mt-1 text-xs text-brand-700">Limite de {LIMITE_ESCALA} itens por escala.</p>}
    </fieldset>
  );
}
