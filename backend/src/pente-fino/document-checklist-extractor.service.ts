import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { R2Service } from '../common/r2/r2.service';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import {
  DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER,
  DocumentChecklistExtractionProvider,
} from './document-checklist-provider.interface';
import { Document } from '../documents/documents.service';

export interface DocumentChecklistRow {
  elaborationDate: string | null;
  elaborationDateSourceExcerpt: string | null;
  professionalName: string | null;
  professionalRegistro: string | null;
  professionalPapel: string | null;
  professionalSourceExcerpt: string | null;
}

const EMPTY_ROW: DocumentChecklistRow = {
  elaborationDate: null,
  elaborationDateSourceExcerpt: null,
  professionalName: null,
  professionalRegistro: null,
  professionalPapel: null,
  professionalSourceExcerpt: null,
};

@Injectable()
export class DocumentChecklistExtractorService {
  private readonly logger = new Logger(DocumentChecklistExtractorService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER)
    private readonly extractor: DocumentChecklistExtractionProvider,
  ) {}

  // Nunca lança exceção — mesma garantia de PenteFinoExtractorService:
  // falha de download/extração/IA é logada e devolve EMPTY_ROW; quem
  // chama decide como reportar isso.
  async extractChecklist(document: Document): Promise<DocumentChecklistRow> {
    try {
      const buffer = await this.r2.getObject(document.file_key);
      const fullText = await this.extractFullText(document.mime_type, buffer);
      if (!fullText) return EMPTY_ROW;

      const result = await this.extractor.extract(fullText);
      const normalizedFullText = normalizeWhitespace(fullText);

      // Verificação determinística: cada excerto citado precisa existir
      // de verdade no texto — mesmo princípio "nunca inventar" de
      // PenteFinoExtractorService. String vazia "" (convenção da IA pra
      // "não encontrado") sempre falha aqui, porque "".includes("") é
      // true em JS — por isso o guard explícito `!== ''` antes de
      // qualquer checagem de substring.
      const dateValid =
        result.elaboration_date !== '' &&
        result.elaboration_date_excerpt !== '' &&
        normalizedFullText.includes(normalizeWhitespace(result.elaboration_date_excerpt)) &&
        isValidIsoDate(result.elaboration_date);

      const professionalValid =
        result.professional_excerpt !== '' &&
        (result.professional_name !== '' || result.professional_registro !== '') &&
        normalizedFullText.includes(normalizeWhitespace(result.professional_excerpt));

      return {
        elaborationDate: dateValid ? result.elaboration_date : null,
        elaborationDateSourceExcerpt: dateValid ? result.elaboration_date_excerpt.trim() : null,
        professionalName: professionalValid && result.professional_name !== '' ? result.professional_name : null,
        professionalRegistro:
          professionalValid && result.professional_registro !== '' ? result.professional_registro : null,
        professionalPapel: professionalValid && result.professional_papel !== '' ? result.professional_papel : null,
        professionalSourceExcerpt: professionalValid ? result.professional_excerpt.trim() : null,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair checklist do documento ${document.id}: ${(err as Error).message}`);
      return EMPTY_ROW;
    }
  }

  // Só o DELETE/INSERT — nenhuma chamada HTTP aqui, seguro segurar o
  // PoolClient. Nunca lança exceção — mesma razão de persistRows.
  async persist(client: PoolClient, document: Document, row: DocumentChecklistRow): Promise<void> {
    try {
      await client.query('DELETE FROM document_checklist_findings WHERE document_id = $1', [document.id]);
      await client.query(
        `INSERT INTO document_checklist_findings
           (tenant_id, document_id, elaboration_date, elaboration_date_source_excerpt,
            professional_name, professional_registro, professional_papel, professional_source_excerpt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          document.tenant_id,
          document.id,
          row.elaborationDate,
          row.elaborationDateSourceExcerpt,
          row.professionalName,
          row.professionalRegistro,
          row.professionalPapel,
          row.professionalSourceExcerpt,
        ],
      );
    } catch (err) {
      this.logger.warn(`Falha ao persistir checklist do documento ${document.id}: ${(err as Error).message}`);
    }
  }

  private async extractFullText(mimeType: string, buffer: Buffer): Promise<string | null> {
    if (mimeType === 'application/pdf') return extractPdfTextFull(buffer);
    if (mimeType === DOCX_MIME_TYPE) return extractDocxText(buffer);
    if (mimeType === XLSX_MIME_TYPE) {
      const rows = await extractXlsxRows(buffer);
      return rows.length > 0 ? rows.join('\n') : null;
    }
    return null;
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Guarda contra a IA devolver algo que não é uma data real (ex.: texto
// mal formatado que escapou da instrução de formato) — um Date inválido
// se propagando pro card do frontend quebraria a formatação ali.
function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}
