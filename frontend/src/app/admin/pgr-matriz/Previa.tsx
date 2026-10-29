'use client';

import { calcularPrevia, type FormMatriz } from './tipos';

// Prévia do mapa de calor: apenas EXIBIÇÃO, calculada aqui a partir das escalas e faixas digitadas.
// Não é validação nem cálculo oficial — o servidor é a referência (publicação, classificação e hash).
export function Previa({ form }: { form: FormMatriz }) {
  const grade = calcularPrevia(form);
  return (
    <section aria-labelledby="previa-titulo" className="adm-card-2 min-w-0 p-4">
      <h4 id="previa-titulo" className="text-sm font-semibold text-brand-900">Prévia do mapa de calor</h4>
      <p className="mt-1 text-xs text-brand-700">
        Prévia calculada neste navegador a partir das escalas e faixas informadas. A validação e o cálculo oficiais são do servidor.
      </p>
      {!grade ? (
        <p className="mt-3 text-sm text-brand-700">Preencha os valores das escalas de severidade e probabilidade para ver a prévia.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="adm-table">
            <caption className="sr-only">Nível de risco por severidade (linhas) e probabilidade (colunas)</caption>
            <thead>
              <tr>
                <th scope="col">Severidade \ Probabilidade</th>
                {grade[0].map((c, j) => (
                  <th key={j} scope="col">{c.prob.rotulo.trim() || `valor ${c.prob.valor}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grade.map((linha, i) => (
                <tr key={i}>
                  <th scope="row">{linha[0].sev.rotulo.trim() || `valor ${linha[0].sev.valor}`}</th>
                  {linha.map((c, j) => (
                    <td key={j} className="text-brand-900">
                      <div className="font-medium">{c.conflito ? 'conflito de faixas' : (c.nivel ?? 'sem faixa')}</div>
                      <div className="text-xs text-brand-700">escore {c.score}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
