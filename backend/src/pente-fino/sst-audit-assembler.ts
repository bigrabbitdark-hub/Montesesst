import { SstAuditFact, SstAuditFactsResult } from './sst-audit-facts.service';
import { SstAuditDocumentRef, SstAuditFinding, SstAuditReportInput } from './sst-audit-report.service';
import {
  buildSstCoverageMatrix,
  evaluateSstAuditRules,
  SstAuditRuleInputFact,
  SstAuditRuleResult,
} from './sst-audit-rules';

export type SstAuditDocType = 'pgr' | 'ltcat' | 'pcmso' | 'lip';

export interface SstAuditAssemblerDocument {
  type: SstAuditDocType;
  id: string;
  title: string;
  extraction: SstAuditFactsResult;
}

const DOC_LABEL: Record<SstAuditDocType, string> = { pgr: 'PGR', ltcat: 'LTCAT', pcmso: 'PCMSO', lip: 'LIP' };
const FINDING_OUTCOMES = new Set(['NC', 'IN', 'EA', 'RC', 'AT', 'RT']);

function documentStatus(status: SstAuditFactsResult['status']): SstAuditDocumentRef['status'] {
  if (status === 'complete') return 'complete';
  if (status === 'partial') return 'partial';
  return 'not_evaluable';
}

function toRuleFact(fact: SstAuditFact, title: string): SstAuditRuleInputFact {
  return {
    id: fact.id,
    document_id: fact.document_id,
    document_title: title,
    fact_type: fact.fact_type,
    subject_type: fact.subject_type,
    subject_raw: fact.subject_raw,
    subject_key: fact.subject_key,
    value_json: fact.value_json,
    unit: fact.unit,
    page_number: fact.page_number,
    source_excerpt: fact.source_excerpt,
  };
}

function toFinding(result: SstAuditRuleResult, index: number, facts: SstAuditRuleInputFact[]): SstAuditFinding {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const isNc = result.outcome === 'NC';
  return {
    id: `rule-${index + 1}`,
    category: result.outcome as SstAuditFinding['category'],
    status: isNc ? 'confirmed' : 'to_confirm',
    confidence: isNc ? 'high' : 'medium',
    summary: result.summary,
    evidence: result.fact_ids
      .map((id) => byId.get(id))
      .filter((fact): fact is SstAuditRuleInputFact => Boolean(fact))
      .map((fact) => ({
        document_id: fact.document_id,
        title: fact.document_title,
        source_excerpt: fact.source_excerpt,
        page: fact.page_number,
      })),
    limitations: result.limitations,
    recommended_verification: result.recommended_verification,
    priority: isNc ? 1 : result.outcome === 'IN' ? 2 : 3,
  };
}

export function assembleSstAuditInput(args: {
  auditDate: Date;
  company: { id: string; name: string };
  documents: SstAuditAssemblerDocument[];
  missingTypes: SstAuditDocType[];
}): SstAuditReportInput {
  const titles = new Map(args.documents.map((document) => [document.id, document.title]));
  const ruleFacts = args.documents.flatMap((document) =>
    document.extraction.facts.map((fact) => toRuleFact(fact, titles.get(fact.document_id) ?? document.title)),
  );

  const results = evaluateSstAuditRules(ruleFacts, args.auditDate);
  const findings = results
    .filter((result) => FINDING_OUTCOMES.has(result.outcome))
    .map((result, index) => toFinding(result, index, ruleFacts));

  const limitations: string[] = [];
  for (const type of args.missingTypes) {
    limitations.push(`${DOC_LABEL[type]} não localizado entre os documentos da empresa.`);
  }
  for (const document of args.documents) {
    const label = DOC_LABEL[document.type];
    if (document.extraction.status === 'failed') {
      limitations.push(`${label}: não foi possível extrair fatos; documento não avaliado.`);
    } else if (document.extraction.unevaluated_pages.length > 0) {
      limitations.push(
        `${label}: página(s) não avaliada(s): ${document.extraction.unevaluated_pages.join(', ')}.`,
      );
    }
  }
  for (const result of results) {
    if (result.outcome === 'not_reported' || result.outcome === 'not_evaluated') {
      limitations.push(result.summary);
    }
  }

  const recommendations = Array.from(
    new Set(results.map((result) => result.recommended_verification).filter(Boolean)),
  );

  return {
    audit_date: args.auditDate.toISOString().slice(0, 10),
    company: args.company,
    documents: args.documents.map((document) => ({
      id: document.id,
      type: document.type,
      title: document.title,
      status: documentStatus(document.extraction.status),
    })),
    findings,
    recommendations,
    limitations,
    coverage_matrix: buildSstCoverageMatrix(
      ruleFacts,
      args.documents.map((document) => ({ id: document.id, title: document.title, extracted_at: null })),
    ),
  };
}
