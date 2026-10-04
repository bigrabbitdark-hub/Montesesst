import { PdfPageText } from '../common/pdf/pdf-text.util';

export type SstAuditDocumentType = 'pgr' | 'ltcat' | 'pcmso' | 'lip';
export type SstAuditEvidenceKind = 'quoted_claim' | 'direct_measurement' | 'document_metadata';

export interface SstAuditFactCandidate {
  factType: string;
  subjectType: string;
  subjectRaw: string;
  subjectKey: string;
  value: Record<string, string | number | boolean | null>;
  unit: string | null;
  pageNumber: number;
  sourceExcerptMasked: string;
  evidenceKind: SstAuditEvidenceKind;
}

export interface SstAuditExtractionPayload {
  facts: SstAuditFactCandidate[];
}

export interface SstAuditFactsExtractionProvider {
  extract(input: {
    documentType: SstAuditDocumentType;
    pages: PdfPageText[];
    groupIndex: number;
  }): Promise<SstAuditExtractionPayload>;
}

export const SST_AUDIT_FACTS_PROVIDER = Symbol('SST_AUDIT_FACTS_PROVIDER');