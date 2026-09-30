'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';

interface PenteFinoDocumentRef {
  id: string;
  title: string;
  extracted_at: string | null;
  elaboration_date: string | null;
  elaboration_date_source_excerpt: string | null;
  professional_name: string | null;
  professional_registro: string | null;
  professional_papel: string | null;
  professional_source_excerpt: string | null;
}

interface FunctionReportItem {
  position_id: string | null;
  position_name: string | null;
  function_text_raw: string;
  status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
  risks: { description: string; source_excerpt: string }[];
  exams: { description: string; source_excerpt: string }[];
}

interface LipAgentFinding {
  agent_name_raw: string;
  agent_category: string;
  measured_value_raw: string | null;
  insalubre: boolean | null;
  conclusion_excerpt: string | null;
  exam_status: 'exame_ausente' | 'ok' | 'informativo';
}

interface AgentCoverageFinding {
  agent_category: string;
  presence: 'ambos' | 'so_lip' | 'so_ltcat';
  agent_names_lip: string[];
  agent_names_ltcat: string[];
}

interface AuditEvidence {
  document_id: string;
  title: string;
  source_excerpt: string;
  page: number | null;
}

interface AuditFinding {
  id: string;
  type: 'function_exam_gap' | 'agent_coverage_gap' | 'quantitative_divergence';
  status: 'inconsistency' | 'insufficient_evidence' | 'to_confirm';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  evidence: AuditEvidence[];
  limitations: string[];
  recommended_verification: string;
}

interface PenteFinoReport {
  pgr_document: PenteFinoDocumentRef | null;
  pcmso_document: PenteFinoDocumentRef | null;
  ltcat_document: PenteFinoDocumentRef | null;
  lip_document: PenteFinoDocumentRef | null;
  functions: FunctionReportItem[];
  lip_agents: LipAgentFinding[];
  agent_coverage: AgentCoverageFinding[];
  audit_findings?: AuditFinding[];
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

function formatExtractedAt(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// elaboration_date vem do backend como coluna Postgres DATE pura
// ("AAAA-MM-DD", sem hora) — diferente de extracted_at, que é um
// timestamp completo. new Date("AAAA-MM-DD") é interpretado como meia-
// noite UTC; em qualquer fuso negativo (ex.: America/Sao_Paulo, UTC-3,
// o fuso de praticamente todo usuário real do Montese SST) isso vira o
// dia anterior ao converter pro horário local. Anexar "T00:00:00" força
// a interpretação em horário local, evitando esse deslocamento de 1 dia.
function formatDateOnly(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('pt-BR');
}

// "Há quanto tempo" de forma neutra — nunca julga vencimento/validade
// legal (decisão da spec §2, achado de brainstorming: NR-01/NR-07 não
// têm um prazo fixo simples de revalidação pro documento como um todo).
function formatElapsedTime(isoDate: string): string {
  // Mesmo ajuste de fuso de formatDateOnly: isoDate é uma data pura
  // ("AAAA-MM-DD"), então precisa do "T00:00:00" pra não perder um dia
  // em fusos negativos antes de comparar com "now" (horário local).
  const then = new Date(`${isoDate}T00:00:00`);
  const now = new Date();
  const totalMonths = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  // Data no futuro (erro de extração) ou no mesmo mês: não faz sentido
  // dizer "há X tempo".
  if (totalMonths <= 0) return 'recentemente';
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ano${years > 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} ${months > 1 ? 'meses' : 'mês'}`);
  return parts.length > 0 ? `há ${parts.join(' e ')}` : 'há menos de um mês';
}

const DOCUMENT_LABELS: { key: 'pgr_document' | 'pcmso_document' | 'ltcat_document' | 'lip_document'; label: string }[] = [
  { key: 'pgr_document', label: 'PGR' },
  { key: 'pcmso_document', label: 'PCMSO' },
  { key: 'ltcat_document', label: 'LTCAT' },
  { key: 'lip_document', label: 'LIP' },
];

const AUDIT_STATUS_LABELS: Record<AuditFinding['status'], string> = {
  inconsistency: 'Divergência a esclarecer',
  insufficient_evidence: 'Evidência insuficiente',
  to_confirm: 'A confirmar',
};

const AUDIT_TYPE_LABELS: Record<AuditFinding['type'], string> = {
  function_exam_gap: 'Relação entre risco e exame',
  agent_coverage_gap: 'Diferença de cobertura entre documentos',
  quantitative_divergence: 'Divergência quantitativa',
};

const CONFIDENCE_LABELS: Record<AuditFinding['confidence'], string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const AUDIT_STATUS_CLASSES: Record<AuditFinding['status'], string> = {
  inconsistency: 'text-amber-800',
  insufficient_evidence: 'text-orange-800',
  to_confirm: 'text-slate-700',
};

function DocumentCard({ label, doc }: { label: string; doc: PenteFinoDocumentRef | null }) {
  if (!doc) {
    return (
      <p className="mt-1 text-sm text-brand-900">
        {label}: <span className="text-slate-500">não localizado nos documentos disponíveis</span>
      </p>
    );
  }
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-sm text-brand-900">
        {label}: {doc.title}
        {doc.extracted_at && ` (extraído em ${formatExtractedAt(doc.extracted_at)})`}
      </p>
      {doc.elaboration_date ? (
        <p className="text-xs text-brand-700">
          última atualização: {formatDateOnly(doc.elaboration_date)} ({formatElapsedTime(doc.elaboration_date)})
        </p>
      ) : (
        <p className="text-xs text-slate-500">data de elaboração não identificada no texto</p>
      )}
      {doc.professional_name || doc.professional_registro ? (
        <p className="text-xs text-brand-700">
          responsável: {doc.professional_name ?? '(nome não identificado)'}
          {doc.professional_papel && ` — ${doc.professional_papel}`}
          {doc.professional_registro && `, registro ${doc.professional_registro}`}
        </p>
      ) : (
        <p className="text-xs text-slate-500">profissional responsável não identificado no texto</p>
      )}
    </div>
  );
}

function AuditFindings({ findings }: { findings: AuditFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="mt-3 text-sm text-brand-700">
        Nenhum achado foi gerado com os dados extraídos. Isso não confirma conformidade; confira os documentos-fonte e os avisos.
      </p>
    );
  }

  return (
    <ol className="mt-3 divide-y divide-brand-50">
      {findings.map((finding) => (
        <li key={finding.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h4 className="text-sm font-semibold text-brand-900">{finding.summary}</h4>
            <span className={`text-sm font-medium ${AUDIT_STATUS_CLASSES[finding.status]}`}>
              {AUDIT_STATUS_LABELS[finding.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-brand-700">
            {`${AUDIT_TYPE_LABELS[finding.type]} · Confiança ${CONFIDENCE_LABELS[finding.confidence]}`}
          </p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-brand-700 underline underline-offset-2">
              Ver evidências e verificação recomendada
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {finding.evidence.map((evidence, index) => (
                <blockquote key={`${evidence.document_id}-${index}`} className="border-l-2 border-brand-200 pl-3">
                  <p className="text-xs font-medium text-brand-900">
                    {evidence.title} · {evidence.page === null ? 'Página não capturada' : `Página ${evidence.page}`}
                  </p>
                  <p className="mt-1 text-sm italic text-brand-700">&quot;{evidence.source_excerpt}&quot;</p>
                </blockquote>
              ))}
              {finding.limitations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-brand-900">Limites da conclusão</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-brand-700">
                    {finding.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-sm text-brand-900">
                <span className="font-semibold">Verificar:</span> {finding.recommended_verification}
              </p>
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function PenteFinoPanel({
  tenantId,
  presentation = 'full',
}: {
  tenantId?: string;
  presentation?: 'full' | 'assistant';
}) {
  const isAssistantPresentation = presentation === 'assistant';
  const fullAuditHref = tenantId ? `/tecnico/empresas/${tenantId}/pente-fino` : '/empresa/pente-fino';
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
        setReport(null);
        setErrorMessage('Limite de execuções da Auditoria Montese atingido. Tente novamente mais tarde.');
        setRunStatus('error');
        return;
      }
      const body = await res.json().catch(() => null);
      const genericMessage = 'Não foi possível executar a Auditoria Montese agora. Tente novamente.';
      const message =
        res.status === 403 && typeof body?.message === 'string' ? body.message : genericMessage;
      setReport(null);
      setErrorMessage(message);
      setRunStatus('error');
    } catch {
      setReport(null);
      setErrorMessage('Não foi possível conectar ao servidor.');
      setRunStatus('error');
    }
  }

  return (
    <div className={`flex flex-col ${isAssistantPresentation ? 'gap-4' : 'gap-6'}`}>
      <section className={isAssistantPresentation ? '' : 'rounded-lg border border-brand-100 p-6'}>
        <h2 className="text-lg font-bold text-brand-900">Auditoria Montese</h2>
        <p className="mt-2 text-sm text-brand-700">
          Cruza fatos extraídos do PGR, PCMSO, LTCAT e LIP. Os achados mostram o que foi localizado,
          o que ainda precisa ser confirmado e quais evidências sustentam cada observação.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={runStatus === 'loading'}
          className="mt-4 self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {runStatus === 'loading' ? 'Executando auditoria...' : 'Executar Auditoria Montese'}
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
          {isAssistantPresentation ? (
            <section aria-labelledby="assistant-audit-findings-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="assistant-audit-findings-heading" className="text-base font-bold text-brand-900">
                  Achados da auditoria
                </h3>
                <Link href={fullAuditHref} className="text-sm font-medium text-brand-700 underline underline-offset-2">
                  Abrir Auditoria Montese completa
                </Link>
              </div>
              <p className="mt-1 text-xs text-brand-700">
                Documentos localizados: {DOCUMENT_LABELS.filter(({ key }) => report[key]).map(({ label }) => label).join(', ') || 'nenhum nos documentos disponíveis'}.
              </p>
              <AuditFindings findings={report.audit_findings ?? []} />
              {report.warnings.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              )}
            </section>
          ) : (
            <>
          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Documentos-fonte</h3>
            {DOCUMENT_LABELS.map(({ key, label }) => (
              <DocumentCard key={key} label={label} doc={report[key]} />
            ))}
            {report.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {report.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Achados da auditoria</h3>
            <AuditFindings findings={report.audit_findings ?? []} />
          </section>

          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Funções</h3>
            {report.functions.length === 0 ? (
              <p className="mt-4 text-sm text-brand-700">
                Nenhuma função pôde ser cruzada com os dados extraídos. Confira os documentos-fonte e os avisos.
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

          {(report.lip_agents ?? []).length > 0 && (
            <section className="rounded-lg border border-brand-100 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Agentes do LIP</h3>
              <ul className="mt-4 flex flex-col gap-3">
                {report.lip_agents.map((agent, i) => (
                  <li key={i} className="rounded-md border border-brand-50 p-3">
                    <p className="text-sm font-medium text-brand-900">
                      {agent.agent_name_raw}
                      {agent.measured_value_raw && ` — ${agent.measured_value_raw}`}
                    </p>
                    {agent.conclusion_excerpt ? (
                      <p className="mt-1 text-xs italic text-brand-700">&quot;{agent.conclusion_excerpt}&quot;</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">conclusão de insalubridade não identificada no texto</p>
                    )}
                    {agent.exam_status === 'exame_ausente' && (
                      <>
                        <p className="mt-2 text-sm font-medium text-red-600">
                          Não encontramos audiometria entre os exames extraídos do PCMSO
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          A checagem procura a palavra &quot;audiometria&quot; nos exames vinculados a uma função e
                          no texto do documento — confira o PCMSO diretamente se tiver dúvida.
                        </p>
                      </>
                    )}
                    {agent.exam_status === 'ok' && (
                      <p className="mt-2 text-sm text-green-700">Exame de audiometria presente no PCMSO</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.agent_coverage.filter((f) => f.presence !== 'ambos').length > 0 && (
            <section className="rounded-lg border border-brand-100 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Cobertura LIP × LTCAT</h3>
              <p className="mt-2 text-sm text-brand-700">
                Categorias citadas na extração de um laudo e não localizadas na extração do outro — a diferença
                pode decorrer de escopo, período ou método distintos e precisa ser conferida nos documentos.
              </p>
              <ul className="mt-3 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {report.agent_coverage
                  .filter((f) => f.presence !== 'ambos')
                  .map((finding, i) => (
                    <li key={i}>
                      {finding.presence === 'so_lip' ? (
                        <>
                          Localizado na extração do LIP: {finding.agent_names_lip.join(', ')} — não localizado na extração do LTCAT ({finding.agent_category}).
                        </>
                      ) : (
                        <>
                          Localizado na extração do LTCAT: {finding.agent_names_ltcat.join(', ')} — não localizado na extração do LIP ({finding.agent_category}).
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}
            </>
          )}
        </>
      )}
    </div>
  );
}
