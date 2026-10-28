'use client';

import { PGR_PENDENCIA_LABEL, type PgrResumo } from '../../../api';

export const ETAPAS = [
  { chave: 'empresa', rotulo: 'Empresa', pendencias: ['cnpj', 'cnae', 'endereco', 'unidades', 'cargos', 'funcionarios'] },
  { chave: 'responsaveis', rotulo: 'Responsáveis', pendencias: [] as string[] },
  { chave: 'ambientes', rotulo: 'Ambientes', pendencias: ['ghes'] },
  { chave: 'riscos', rotulo: 'Riscos', pendencias: ['riscos'] },
] as const;
export type EtapaChave = (typeof ETAPAS)[number]['chave'];

// Barra de etapas: cada etapa é salva de forma independente (o servidor guarda o rascunho), então a navegação é livre.
export function Etapas({ atual, onIr, resumo }: { atual: EtapaChave; onIr: (e: EtapaChave) => void; resumo: PgrResumo }) {
  const pendencias = resumo.pendencias.map((p) => PGR_PENDENCIA_LABEL[p] ?? p);
  return (
    <div className="mb-6">
      <nav aria-label="Etapas do PGR">
        <ol className="grid gap-2 sm:grid-cols-4">
          {ETAPAS.map((e, i) => {
            const faltam = e.pendencias.filter((p) => resumo.pendencias.includes(p)).length;
            const ativa = e.chave === atual;
            return (
              <li key={e.chave}>
                <button
                  type="button"
                  aria-current={ativa ? 'step' : undefined}
                  onClick={() => onIr(e.chave)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary ${
                    ativa ? 'border-dash-primary bg-dash-primary text-white' : 'border-dash-border-input bg-white text-dash-primary'
                  }`}
                >
                  {i + 1}. {e.rotulo}
                  {faltam > 0 && <span className={`ml-2 text-xs font-normal ${ativa ? 'text-white' : 'text-dash-muted'}`}>({faltam} pendente{faltam > 1 ? 's' : ''})</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-dash-muted">
          <span>Completude do inventário</span>
          <span>{resumo.completude}%</span>
        </div>
        <div
          role="progressbar" aria-label="Completude do inventário" aria-valuemin={0} aria-valuemax={100} aria-valuenow={resumo.completude}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full bg-dash-primary" style={{ width: `${resumo.completude}%` }} />
        </div>
        <p className="mt-2 text-sm text-dash-muted">Pendências: {pendencias.length ? pendencias.join(', ') : 'nenhuma'}</p>
      </div>
    </div>
  );
}
