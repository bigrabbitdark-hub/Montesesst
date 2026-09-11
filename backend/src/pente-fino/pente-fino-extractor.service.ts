import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { R2Service } from '../common/r2/r2.service';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { normalizePositionText } from '../common/text/normalize-position-text.util';
import { FUNCTION_EXTRACTION_PROVIDER, FunctionExtractionProvider } from './function-extraction-provider.interface';
import { Document } from '../documents/documents.service';

export interface ExtractedRow {
  functionTextRaw: string;
  positionId: string | null;
  description: string;
  sourceExcerpt: string;
}

@Injectable()
export class PenteFinoExtractorService {
  private readonly logger = new Logger(PenteFinoExtractorService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(FUNCTION_EXTRACTION_PROVIDER) private readonly extractor: FunctionExtractionProvider,
  ) {}

  // Nunca lança exceção — mesma garantia de CompanyDocumentIndexerService
  // (Fase 24): falha de download/extração/IA é logada e devolve lista
  // vazia; o chamador (PenteFinoComparisonService) decide como reportar
  // isso no relatório.
  async extractRows(
    document: Document,
    kind: 'risco' | 'exame',
    positions: { id: string; name: string }[],
  ): Promise<ExtractedRow[]> {
    try {
      const buffer = await this.r2.getObject(document.file_key);
      const fullText = await this.extractFullText(document.mime_type, buffer);
      if (!fullText) return [];

      const items = await this.extractor.extract(fullText, kind);
      const normalizedFullText = normalizeWhitespace(fullText);

      const rows: ExtractedRow[] = [];
      for (const item of items) {
        // Verificação determinística: o trecho citado precisa existir de
        // verdade no texto extraído — mesmo princípio "nunca inventar" do
        // Verificador do Assistente (Fase 9/24), adaptado pra citação de
        // trecho literal em vez de chunk_id. Item que não bate é
        // descartado, nunca persistido.
        const normalizedExcerpt = normalizeWhitespace(item.source_excerpt);
        if (!normalizedFullText.includes(normalizedExcerpt)) continue;

        rows.push({
          functionTextRaw: item.function_text.trim(),
          positionId: this.matchPosition(item.function_text, positions),
          description: item.description.trim(),
          sourceExcerpt: item.source_excerpt.trim(),
        });
      }
      return rows;
    } catch (err) {
      this.logger.warn(`Falha ao extrair funções do documento ${document.id}: ${(err as Error).message}`);
      return [];
    }
  }

  // Só o INSERT/DELETE — nenhuma chamada HTTP aqui, por isso seguro
  // segurar o PoolClient. Apaga extração anterior do mesmo documento
  // antes de inserir (idempotente pra re-rodar sem duplicar). Nunca
  // lança exceção — mesma razão de CompanyDocumentIndexerService.
  async persistRows(
    client: PoolClient,
    document: Document,
    kind: 'risco' | 'exame',
    rows: ExtractedRow[],
  ): Promise<void> {
    try {
      if (kind === 'risco') {
        await client.query('DELETE FROM pgr_function_risks WHERE document_id = $1', [document.id]);
        for (const row of rows) {
          await client.query(
            `INSERT INTO pgr_function_risks (tenant_id, document_id, position_id, function_text_raw, risk_description, source_excerpt)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [document.tenant_id, document.id, row.positionId, row.functionTextRaw, row.description, row.sourceExcerpt],
          );
        }
      } else {
        await client.query('DELETE FROM pcmso_function_exams WHERE document_id = $1', [document.id]);
        for (const row of rows) {
          await client.query(
            `INSERT INTO pcmso_function_exams (tenant_id, document_id, position_id, function_text_raw, exam_description, source_excerpt)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [document.tenant_id, document.id, row.positionId, row.functionTextRaw, row.description, row.sourceExcerpt],
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Falha ao persistir extração do documento ${document.id}: ${(err as Error).message}`);
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

  // Público porque PenteFinoComparisonService precisa re-derivar o
  // position_id de uma extração já persistida: o valor guardado foi resolvido
  // contra a lista de cargos de quando a extração rodou, e cadastrar o cargo
  // que faltava (a ação que o status 'nome_sem_correspondencia' justamente
  // pede) não pode continuar devolvendo o mesmo resultado velho.
  matchPosition(functionText: string, positions: { id: string; name: string }[]): string | null {
    const normalized = normalizePositionText(functionText);
    const match = positions.find((p) => normalizePositionText(p.name) === normalized);
    return match?.id ?? null;
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
