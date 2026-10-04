export type SstAuditDocumentStatus = 'complete' | 'partial' | 'not_evaluable';

export interface SstAuditDocumentRef {
  id: string;
  type: 'pgr' | 'ltcat' | 'pcmso' | 'lip';
  title: string;
  status: SstAuditDocumentStatus;
}

export interface SstAuditFinding {
  id: string;
  category: 'NC' | 'IN' | 'EA' | 'RC' | 'AT' | 'RT';
  status: 'confirmed' | 'to_confirm' | 'insufficient_evidence';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  evidence: Array<{ document_id: string; title: string; source_excerpt: string; page: number | null }>;
  limitations: string[];
  recommended_verification: string;
  priority?: 1 | 2 | 3;
}

export interface SstAuditReportInput {
  audit_date: string;
  company: { id: string; name: string };
  documents: SstAuditDocumentRef[];
  findings: SstAuditFinding[];
  recommendations: string[];
  limitations: string[];
  coverage_matrix: Array<{ item: string; document_results: Array<{ document_type: string; status: string; fact_ids: string[]; evidence: Array<{ document_id: string; title: string; source_excerpt: string; page: number | null }> }> }>;
}

export interface SstAuditReport {
  audit_id: string;
  generated_at: string;
  audit_status: SstAuditDocumentStatus;
  company: { id: string; name: string };
  documents: SstAuditDocumentRef[];
  scope_counts: { total: number; complete: number; partial: number; not_evaluable: number };
  summary: {
    conclusion: string;
    nc_count: number;
    inconsistency_count: number;
    missing_evidence_count: number;
    risks_to_confirm_count: number;
    first_correction_priority?: number;
  };
  coverage_matrix: Array<{ item: string; document_results: Array<{ document_type: string; status: string; fact_ids: string[]; evidence: Array<{ document_id: string; title: string; source_excerpt: string; page: number | null }> }> }>;
  findings: SstAuditFinding[];
  recommendations: string[];
  limitations: string[];
  functions: Array<{ name: string; status: string }>;
  lip_agents: Array<{ name: string }>;
  agent_coverage: Array<{ item: string }>;
  warnings: string[];
}

export function buildSstAuditReport(input: SstAuditReportInput): SstAuditReport {
  const ncCount = input.findings.filter((finding) => finding.category === 'NC').length;
  const inconsistencyCount = input.findings.filter((finding) => finding.category === 'IN').length;
  const missingEvidenceCount = input.limitations.length;
  const risksToConfirmCount = input.findings.filter((finding) => finding.category === 'RC' || finding.category === 'AT').length;
  const partialDocuments = input.documents.filter((document) => document.status === 'partial').length;
  const auditStatus = partialDocuments > 0 ? 'partial' : 'complete';

  return {
    audit_id: `audit-${input.audit_date}`,
    generated_at: new Date().toISOString(),
    audit_status: auditStatus,
    company: input.company,
    documents: input.documents,
    scope_counts: {
      total: input.documents.length,
      complete: input.documents.filter((document) => document.status === 'complete').length,
      partial: partialDocuments,
      not_evaluable: input.documents.filter((document) => document.status === 'not_evaluable').length,
    },
    summary: {
      conclusion: partialDocuments > 0
        ? 'Audição parcial: há achados relevantes e alguns documentos/trechos foram marcados como não avaliados.'
        : 'Audição concluída: o conjunto documental disponível foi avaliado, mas isso não confirma conformidade total.',
      nc_count: ncCount,
      inconsistency_count: inconsistencyCount,
      missing_evidence_count: missingEvidenceCount,
      risks_to_confirm_count: risksToConfirmCount,
      first_correction_priority: input.findings[0]?.priority ?? 1,
    },
    coverage_matrix: input.coverage_matrix,
    findings: input.findings,
    recommendations: input.recommendations,
    limitations: input.limitations,
    functions: [],
    lip_agents: [],
    agent_coverage: [],
    warnings: partialDocuments > 0 ? ['Alguns documentos ou páginas foram marcados como não avaliados; não são ausência de risco.'] : [],
  };
}
