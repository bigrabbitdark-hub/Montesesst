import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService, TenantContext } from '../common/database/database.service';
import { extractPdfPages, PdfPageText } from '../common/pdf/pdf-text.util';
import { redactPii } from '../common/text/pii-redaction.util';
import { R2Service } from '../common/r2/r2.service';
import { Document } from '../documents/documents.service';
import {
  SstAuditDocumentType,
  SstAuditEvidenceKind,
  SstAuditFactCandidate,
  SstAuditFactsExtractionProvider,
  SST_AUDIT_FACTS_PROVIDER,
} from './sst-audit-facts-provider.interface';

export const FACT_EXTRACTOR_VERSION = 'sst-audit-facts-v1';
const MAX_GROUP_CHARACTERS = 16_000;
const MAX_GROUP_PAGES = 8;
const MAX_CONCURRENT_GROUPS = 2;

export interface SstAuditFact {
  id: string;
  tenant_id: string;
  extraction_id: string;
  document_id: string;
  fact_type: string;
  subject_type: string;
  subject_raw: string;
  subject_key: string;
  value_json: Record<string, string | number | boolean | null>;
  unit: string | null;
  evidence_kind: SstAuditEvidenceKind;
  confidence: 'high' | 'medium';
  page_number: number;
  source_excerpt: string;
}

export interface SstAuditDocumentExtraction {
  id: string | null;
  tenant_id: string;
  document_id: string;
  document_sha256: string | null;
  extractor_version: string;
  page_count: number;
  status: 'complete' | 'partial' | 'failed';
  unevaluated_pages: number[];
}

export interface SstAuditFactsResult extends SstAuditDocumentExtraction {
  facts: SstAuditFact[];
}

interface StoredExtraction extends SstAuditDocumentExtraction {}

@Injectable()
export class SstAuditFactsService {
  constructor(
    private readonly r2: R2Service,
    @Inject(SST_AUDIT_FACTS_PROVIDER) private readonly provider: SstAuditFactsExtractionProvider,
    private readonly db: DatabaseService,
  ) {}

  async getFacts(ctx: TenantContext, document: Document): Promise<SstAuditFactsResult> {
    let buffer: Buffer;
    try {
      buffer = await this.r2.getObject(document.file_key);
    } catch {
      return this.failedResult(document);
    }

    const documentSha256 = createHash('sha256').update(buffer).digest('hex');
    const cached = await this.db.withTenantContext(ctx, (client) => this.loadCached(client, document, documentSha256));
    if (cached) return cached;

    const pages = await extractPdfPages(buffer);
    if (pages.length === 0) {
      return this.persistExtraction(ctx, document, documentSha256, 0, 'failed', [], []);
    }

    const employeeNames = await this.db.withTenantContext(ctx, async (client) => {
      const result = await client.query<{ full_name: string }>(
        `SELECT full_name FROM employees WHERE tenant_id = $1 AND status = 'ativo'`,
        [document.tenant_id],
      );
      return result.rows.map((row) => row.full_name);
    });

    const safePages: PdfPageText[] = [];
    const unevaluatedPages: number[] = [];
    for (const page of pages) {
      const redactedText = redactPii(page.text, employeeNames);
      if (!redactedText.trim() || (document.category === 'pcmso' && containsIndividualClinicalResult(redactedText))) {
        unevaluatedPages.push(page.pageNumber);
        continue;
      }
      safePages.push({ pageNumber: page.pageNumber, text: redactedText });
    }

    const pageByNumber = new Map(safePages.map((page) => [page.pageNumber, page.text]));
    const acceptedCandidates: SstAuditFactCandidate[] = [];
    const groups = groupPages(safePages);
    for (let offset = 0; offset < groups.length; offset += MAX_CONCURRENT_GROUPS) {
      const batch = groups.slice(offset, offset + MAX_CONCURRENT_GROUPS);
      const results = await Promise.all(
        batch.map(async (group, groupOffset) => {
          try {
            return {
              group,
              failed: false,
              candidates: await this.provider.extract({
                documentType: document.category as SstAuditDocumentType,
                pages: group,
                groupIndex: offset + groupOffset,
              }),
            };
          } catch {
            return { group, failed: true, candidates: { facts: [] } };
          }
        }),
      );

      for (const { group, failed, candidates } of results) {
        if (failed) {
          unevaluatedPages.push(...group.map((page) => page.pageNumber));
          continue;
        }
        for (const candidate of candidates.facts) {
          const pageText = pageByNumber.get(candidate.pageNumber);
          if (!pageText || !isValidCandidate(candidate, pageText, employeeNames)) {
            if (pageByNumber.has(candidate.pageNumber)) unevaluatedPages.push(candidate.pageNumber);
            continue;
          }
          acceptedCandidates.push(candidate);
        }
      }
    }

    const uniqueUnevaluatedPages = [...new Set(unevaluatedPages)].sort((a, b) => a - b);
    const status = uniqueUnevaluatedPages.length > 0 ? 'partial' : 'complete';
    return this.persistExtraction(ctx, document, documentSha256, pages.length, status, uniqueUnevaluatedPages, acceptedCandidates);
  }

  private async loadCached(
    client: PoolClient,
    document: Document,
    documentSha256: string,
  ): Promise<SstAuditFactsResult | null> {
    const extractionResult = await client.query<StoredExtraction>(
      `SELECT id, tenant_id, document_id, document_sha256, extractor_version, page_count, status, unevaluated_pages
       FROM sst_audit_document_extractions
       WHERE document_id = $1 AND document_sha256 = $2 AND extractor_version = $3
       LIMIT 1`,
      [document.id, documentSha256, FACT_EXTRACTOR_VERSION],
    );
    const extraction = extractionResult.rows[0];
    if (!extraction) return null;

    const factsResult = await client.query<SstAuditFact>(
      `SELECT id, tenant_id, extraction_id, document_id, fact_type, subject_type, subject_raw, subject_key,
              value_json, unit, evidence_kind, confidence, page_number, source_excerpt
       FROM sst_audit_facts WHERE extraction_id = $1 ORDER BY page_number, id`,
      [extraction.id],
    );
    return { ...extraction, facts: factsResult.rows };
  }

  private async persistExtraction(
    ctx: TenantContext,
    document: Document,
    documentSha256: string | null,
    pageCount: number,
    status: SstAuditDocumentExtraction['status'],
    unevaluatedPages: number[],
    candidates: SstAuditFactCandidate[],
  ): Promise<SstAuditFactsResult> {
    if (!documentSha256) {
      return { ...this.failedResult(document), page_count: pageCount, unevaluated_pages: unevaluatedPages, facts: [] };
    }

    return this.db.withTenantContext(ctx, async (client) => {
      const extractionResult = await client.query<StoredExtraction>(
        `INSERT INTO sst_audit_document_extractions
           (tenant_id, document_id, document_sha256, extractor_version, page_count, status, unevaluated_pages)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (document_id, document_sha256, extractor_version) DO UPDATE
           SET page_count = EXCLUDED.page_count, status = EXCLUDED.status,
               unevaluated_pages = EXCLUDED.unevaluated_pages
         RETURNING id, tenant_id, document_id, document_sha256, extractor_version, page_count, status, unevaluated_pages`,
        [document.tenant_id, document.id, documentSha256, FACT_EXTRACTOR_VERSION, pageCount, status, unevaluatedPages],
      );
      const extraction = extractionResult.rows[0];
      if (!extraction) throw new Error('Não foi possível registrar a extração dos documentos.');

      await client.query('DELETE FROM sst_audit_facts WHERE extraction_id = $1', [extraction.id]);
      const facts: SstAuditFact[] = [];
      for (const candidate of candidates) {
        const confidence = deriveConfidence(candidate);
        const factResult = await client.query<SstAuditFact>(
          `INSERT INTO sst_audit_facts
             (tenant_id, extraction_id, document_id, fact_type, subject_type, subject_raw, subject_key,
              value_json, unit, evidence_kind, confidence, page_number, source_excerpt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id, tenant_id, extraction_id, document_id, fact_type, subject_type, subject_raw, subject_key,
                     value_json, unit, evidence_kind, confidence, page_number, source_excerpt`,
          [
            document.tenant_id,
            extraction.id,
            document.id,
            candidate.factType,
            candidate.subjectType,
            candidate.subjectRaw,
            candidate.subjectKey,
            JSON.stringify(candidate.value),
            candidate.unit,
            candidate.evidenceKind,
            confidence,
            candidate.pageNumber,
            candidate.sourceExcerptMasked,
          ],
        );
        if (factResult.rows[0]) facts.push(factResult.rows[0]);
      }
      return { ...extraction, facts };
    });
  }

  private failedResult(document: Document): SstAuditFactsResult {
    return {
      id: null,
      tenant_id: document.tenant_id,
      document_id: document.id,
      document_sha256: null,
      extractor_version: FACT_EXTRACTOR_VERSION,
      page_count: 0,
      status: 'failed',
      unevaluated_pages: [],
      facts: [],
    };
  }
}

function groupPages(pages: PdfPageText[]): PdfPageText[][] {
  const groups: PdfPageText[][] = [];
  let current: PdfPageText[] = [];
  let currentLength = 0;
  for (const page of pages) {
    const nextLength = currentLength + page.text.length;
    if (current.length > 0 && (current.length >= MAX_GROUP_PAGES || nextLength > MAX_GROUP_CHARACTERS)) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(page);
    currentLength += page.text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function containsIndividualClinicalResult(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(resultado(?:s)? (?:do|de) exame|diagnostico|cid\s*[-:]?\s*[a-z]\d|apto|inapto|alterado|alterada|queixa clinica|conduta medica|prescricao)\b/.test(
    normalized,
  );
}

function isValidCandidate(
  candidate: SstAuditFactCandidate,
  pageText: string,
  employeeNames: string[],
): boolean {
  if (
    !candidate.factType.trim() ||
    !candidate.subjectType.trim() ||
    !candidate.subjectRaw.trim() ||
    !candidate.subjectKey.trim() ||
    candidate.pageNumber <= 0 ||
    !candidate.sourceExcerptMasked.trim() ||
    !['quoted_claim', 'direct_measurement', 'document_metadata'].includes(candidate.evidenceKind)
  ) {
    return false;
  }
  const normalizedPage = normalizeText(pageText);
  const normalizedExcerpt = normalizeText(candidate.sourceExcerptMasked);
  if (!normalizedPage.includes(normalizedExcerpt)) return false;

  const candidateText = `${candidate.subjectRaw} ${candidate.subjectKey} ${candidate.sourceExcerptMasked} ${JSON.stringify(candidate.value)}`;
  if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(candidateText)) return false;
  return employeeNames.every((name) => !containsName(candidateText, name));
}

function deriveConfidence(candidate: SstAuditFactCandidate): 'high' | 'medium' {
  if (candidate.evidenceKind === 'direct_measurement' && measurementIsQuoted(candidate)) return 'high';
  if (candidate.evidenceKind === 'document_metadata' && Object.values(candidate.value).some((value) =>
    typeof value === 'string' && normalizeText(candidate.sourceExcerptMasked).includes(normalizeText(value)),
  )) return 'high';
  return 'medium';
}

function measurementIsQuoted(candidate: SstAuditFactCandidate): boolean {
  const rawValue = candidate.value.value;
  if (typeof rawValue !== 'number' || !candidate.unit) return false;
  const text = normalizeText(candidate.sourceExcerptMasked).replace(',', '.');
  const normalizedUnit = normalizeText(candidate.unit).replace(/[\s()]/g, '');
  return text.includes(String(rawValue)) && text.replace(/[\s()]/g, '').includes(normalizedUnit);
}

function containsName(text: string, name: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedName = normalizeText(name);
  return normalizedName.length >= 4 && normalizedText.includes(normalizedName);
}

function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}