'use client';

// Erros e pendências devolvidos pelo servidor, em região acessível: role="alert" quando há algo a corrigir,
// role="status" quando está tudo certo. Cada mensagem é um item de lista, exatamente como o servidor mandou.
export function ResultadoValidacao({ mensagem, erros, pendencias, vazio }: {
  mensagem?: string; erros: string[]; pendencias: string[]; vazio?: string;
}) {
  if (!mensagem && erros.length === 0 && pendencias.length === 0) {
    return vazio ? <p role="status" className="adm-card-2 px-3 py-2 text-sm text-adm-status-ok-text">{vazio}</p> : null;
  }
  return (
    <div role="alert" className="adm-card-2 flex flex-col gap-3 px-3 py-3 text-sm text-brand-900">
      {mensagem && <p className="font-medium text-adm-status-crit-text">{mensagem}</p>}
      {erros.length > 0 && (
        <div>
          <p className="font-semibold text-adm-status-crit-text">Erros ({erros.length})</p>
          <ul className="mt-1 list-disc pl-5">{erros.map((e, i) => <li key={`e${i}`}>{e}</li>)}</ul>
        </div>
      )}
      {pendencias.length > 0 && (
        <div>
          <p className="font-semibold text-adm-status-warn-text">Pendências ({pendencias.length})</p>
          <ul className="mt-1 list-disc pl-5">{pendencias.map((p, i) => <li key={`p${i}`}>{p}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
