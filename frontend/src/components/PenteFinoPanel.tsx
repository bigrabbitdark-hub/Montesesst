'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';

interface PenteFinoDocumentRef {
  id: string;
  title: string;
  extracted_at: string | null;
}

interface FunctionReportItem {
  position_id: string | null;
  position_name: string | null;
  function_text_raw: string;
  status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
  risks: { description: string; source_excerpt: string }[];
  exams: { description: string; source_excerpt: string }[];
}

interface PenteFinoReport {
  pgr_document: PenteFinoDocumentRef | null;
  pcmso_document: PenteFinoDocumentRef | null;
  functions: FunctionReportItem[];
  warnings: string[];
}

type RunStatus = 'idle' | 'loading' | 'done' | 'error';

const STATUS_LABELS: Record<FunctionReportItem['status'], string> = {
  risco_sem_exame: 'Risco sem exame',
  exame_sem_risco: 'Exame sem risco correspondente',
  ok: 'Em dia',
  nome_sem_correspondencia: 'Sem cargo cadastrado',
};

const STATUS_CLASSES: Record<FunctionReportItem['status'], string> = {
  risco_sem_exame: 'text-red-600',
  exame_sem_risco: 'text-amber-700',
  ok: 'text-green-700',
  nome_sem_correspondencia: 'text-slate-500',
};

function formatDate(isoDateTime: string): string {
  const [year, month, day] = isoDateTime.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function PenteFinoPanel({ tenantId }: { tenantId?: string }) {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [report, setReport] = useState<PenteFinoReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set());

  function toggleExpanded(index: number) {
    setExpandedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleRun() {
    setRunStatus('loading');
    setErrorMessage('');
    setRetryAfterSeconds(null);
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/pente-fino/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(tenantId ? { tenant_id: tenantId } : {}),
      });
      if (res.ok) {
        setReport(await res.json());
        setExpandedIndexes(new Set());
        setRunStatus('done');
        return;
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        setRetryAfterSeconds(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
        setErrorMessage('Limite de execuções do Pente-Fino atingido. Tente novamente mais tarde.');
        setRunStatus('error');
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível rodar o Pente-Fino agora. Tente novamente.');
      setRunStatus('error');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setRunStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Cruzamento PGR × PCMSO</h2>
        <p className="mt-2 text-sm text-brand-700">
          Compara as funções descritas no PGR com os exames do PCMSO e aponta risco sem exame
          correspondente, exame sem risco que o justifique, e nomes de função sem cargo cadastrado.
          Pode levar até 2 minutos.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={runStatus === 'loading'}
          className="mt-4 self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {runStatus === 'loading' ? 'Rodando...' : 'Rodar Pente-Fino'}
        </button>
        {runStatus === 'error' && (
          <p className="mt-3 text-sm text-red-600">
            {errorMessage}
            {retryAfterSeconds !== null &&
              ` (tente novamente em ${Math.ceil(retryAfterSeconds / 60)} minuto(s))`}
          </p>
        )}
      </section>

      {report && (
        <>
          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Documentos-fonte</h3>
            <p className="mt-2 text-sm text-brand-900">
              PGR: {report.pgr_document ? report.pgr_document.title : 'nenhum PGR encontrado'}
              {report.pgr_document?.extracted_at &&
                ` (extraído em ${formatDate(report.pgr_document.extracted_at)})`}
            </p>
            <p className="mt-1 text-sm text-brand-900">
              PCMSO: {report.pcmso_document ? report.pcmso_document.title : 'nenhum PCMSO encontrado'}
              {report.pcmso_document?.extracted_at &&
                ` (extraído em ${formatDate(report.pcmso_document.extracted_at)})`}
            </p>
            {report.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {report.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Funções</h3>
            {report.functions.length === 0 ? (
              <p className="mt-4 text-sm text-brand-700">
                Nenhuma função extraída ainda — envie PGR e PCMSO e rode de novo.
              </p>
            ) : (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-brand-700">
                    <th className="px-2 py-1">Função</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {report.functions.map((item, index) => {
                    const isExpanded = expandedIndexes.has(index);
                    const hasDetails = item.risks.length > 0 || item.exams.length > 0;
                    return (
                      <Fragment key={`${item.position_id ?? item.function_text_raw}-${index}`}>
                        <tr className="border-t border-brand-50">
                          <td className="px-2 py-2 font-medium text-brand-900">
                            {item.position_name ?? item.function_text_raw}
                          </td>
                          <td className={`px-2 py-2 ${STATUS_CLASSES[item.status]}`}>
                            {STATUS_LABELS[item.status]}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {hasDetails && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(index)}
                                className="text-brand-500 hover:underline"
                              >
                                {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-brand-50 bg-brand-50">
                            <td colSpan={3} className="px-2 py-3">
                              {item.risks.length > 0 && (
                                <div className="mb-3">
                                  <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">
                                    Riscos (PGR)
                                  </h4>
                                  <ul className="mt-1 flex flex-col gap-2">
                                    {item.risks.map((risk, i) => (
                                      <li key={i} className="text-sm text-brand-900">
                                        {risk.description}
                                        <p className="text-xs italic text-brand-700">
                                          &quot;{risk.source_excerpt}&quot;
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {item.exams.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">
                                    Exames (PCMSO)
                                  </h4>
                                  <ul className="mt-1 flex flex-col gap-2">
                                    {item.exams.map((exam, i) => (
                                      <li key={i} className="text-sm text-brand-900">
                                        {exam.description}
                                        <p className="text-xs italic text-brand-700">
                                          &quot;{exam.source_excerpt}&quot;
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {item.status === 'nome_sem_correspondencia' &&
                                (tenantId ? (
                                  <p className="mt-2 text-sm text-slate-500">
                                    Sem cargo cadastrado — peça pra empresa cadastrar em Mapa SST.
                                  </p>
                                ) : (
                                  <Link
                                    href="/empresa/mapa-sst"
                                    className="mt-2 inline-block text-sm text-brand-500 underline hover:text-brand-700"
                                  >
                                    Cadastrar cargo no Mapa SST
                                  </Link>
                                ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
