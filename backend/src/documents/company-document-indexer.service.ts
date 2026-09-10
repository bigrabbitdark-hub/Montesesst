import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import { splitIntoChunks } from '../common/chunking/chunking.util';
import { toVectorLiteral } from '../common/vector/vector.util';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { Document } from './documents.service';

const INDEXABLE_CATEGORIES = ['pgr', 'pcmso', 'ltcat', 'lip'];
const INDEXABLE_MIME_TYPES = ['application/pdf', DOCX_MIME_TYPE, XLSX_MIME_TYPE];

@Injectable()
export class CompanyDocumentIndexerService {
  private readonly logger = new Logger(CompanyDocumentIndexerService.name);

  constructor(@Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider) {}

  shouldIndex(category: string, mimeType: string): boolean {
    return INDEXABLE_CATEGORIES.includes(category) && INDEXABLE_MIME_TYPES.includes(mimeType);
  }

  // Nunca lança exceção — falha de extração/embedding/insert é logada e
  // engolida aqui, porque o upload do documento (já commitado antes desta
  // chamada, ver DocumentsController) nunca pode ser derrubado por uma
  // falha de indexação (spec §2, "non-blocking").
  async indexDocument(client: PoolClient, document: Document, fileBuffer: Buffer): Promise<void> {
    try {
      const text = await this.extractText(document.mime_type, fileBuffer);
      if (!text) return;

      const chunks = splitIntoChunks(text);
      if (chunks.length === 0) return;

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.embeddings.embed(chunks[i]);
        await client.query(
          `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [document.tenant_id, document.id, document.category, i, chunks[i], toVectorLiteral(embedding)],
        );
      }
    } catch (err) {
      this.logger.warn(`Falha ao indexar documento ${document.id}: ${(err as Error).message}`);
    }
  }

  private async extractText(mimeType: string, buffer: Buffer): Promise<string | null> {
    if (mimeType === 'application/pdf') return extractPdfTextFull(buffer);
    if (mimeType === DOCX_MIME_TYPE) return extractDocxText(buffer);
    if (mimeType === XLSX_MIME_TYPE) {
      const rows = await extractXlsxRows(buffer);
      return rows.length > 0 ? rows.join('\n') : null;
    }
    return null;
  }
}
