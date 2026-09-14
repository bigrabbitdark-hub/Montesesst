import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { R2Service } from '../common/r2/r2.service';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { ALLOWED_CATEGORIES } from './lip-agent-extraction-shared';
import { LIP_AGENT_EXTRACTION_PROVIDER, LipAgentExtractionProvider } from './lip-agent-provider.interface';
import { Document } from '../documents/documents.service';

export type AgentCategory = (typeof ALLOWED_CATEGORIES)[number];

export interface LipAgentRow {
  agentNameRaw: string;
  agentCategory: AgentCategory;
  measuredValueRaw: string | null;
  insalubre: boolean | null;
  conclusionExcerpt: string | null;
  sourceExcerpt: string;
}

@Injectable()
export class LipAgentExtractorService {
  private readonly logger = new Logger(LipAgentExtractorService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(LIP_AGENT_EXTRACTION_PROVIDER) private readonly extractor: LipAgentExtractionProvider,
  ) {}

  // Nunca lança exceção — mesma garantia de PenteFinoExtractorService/
  // DocumentChecklistExtractorService: falha de download/extração/IA é
  // logada e devolve lista vazia; quem chama decide como reportar isso.
  async extractAgents(document: Document): Promise<LipAgentRow[]> {
    try {
      const buffer = await this.r2.getObject(document.file_key);
      const fullText = await this.extractFullText(document.mime_type, buffer);
      if (!fullText) return [];

      const items = await this.extractor.extract(fullText);
      const normalizedFullText = normalizeWhitespace(fullText);

      const rows: LipAgentRow[] = [];
      for (const item of items) {
        // Mesmo princípio "nunca inventar": source_excerpt precisa
        // existir de verdade no texto. Item sem source_excerpt válido é
        // descartado por completo (nem o nome do agente é confiável
        // sem uma citação real sustentando a extração).
        if (item.source_excerpt === '') continue;
        const normalizedSource = normalizeWhitespace(item.source_excerpt);
        if (!normalizedFullText.includes(normalizedSource)) continue;

        // conclusion_excerpt segue a mesma regra "" = não encontrado,
        // com verificação de citação própria — pode vir vazio mesmo com
        // source_excerpt válido (agente mencionado sem conclusão
        // declarada).
        const conclusionValid =
          item.conclusion_excerpt !== '' &&
          normalizedFullText.includes(normalizeWhitespace(item.conclusion_excerpt));

        const category = (ALLOWED_CATEGORIES as readonly string[]).includes(item.agent_category)
          ? (item.agent_category as AgentCategory)
          : 'outro';

        rows.push({
          agentNameRaw: item.agent_name_raw.trim(),
          agentCategory: category,
          measuredValueRaw: item.measured_value_raw !== '' ? item.measured_value_raw.trim() : null,
          insalubre: conclusionValid ? deriveInsalubre(item.conclusion_excerpt) : null,
          conclusionExcerpt: conclusionValid ? item.conclusion_excerpt.trim() : null,
          sourceExcerpt: item.source_excerpt.trim(),
        });
      }
      return rows;
    } catch (err) {
      this.logger.warn(`Falha ao extrair agentes do documento ${document.id}: ${(err as Error).message}`);
      return [];
    }
  }

  // Só o DELETE/INSERT — nenhuma chamada HTTP aqui, seguro segurar o
  // PoolClient. Nunca lança exceção — mesma razão de persistRows.
  async persist(client: PoolClient, document: Document, rows: LipAgentRow[]): Promise<void> {
    try {
      await client.query('DELETE FROM lip_agent_findings WHERE document_id = $1', [document.id]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO lip_agent_findings
             (tenant_id, document_id, agent_name_raw, agent_category, measured_value_raw, insalubre, conclusion_excerpt, source_excerpt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            document.tenant_id,
            document.id,
            row.agentNameRaw,
            row.agentCategory,
            row.measuredValueRaw,
            row.insalubre,
            row.conclusionExcerpt,
            row.sourceExcerpt,
          ],
        );
      }
    } catch (err) {
      this.logger.warn(`Falha ao persistir agentes do documento ${document.id}: ${(err as Error).message}`);
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

// Deriva insalubre a partir do TEXTO JÁ CITADO (nunca recalcula NR-15) —
// normaliza espaços/quebras de linha antes de comparar (o excerto pode
// vir com quebra de linha do PDF original, ex.: "não\ncaracteriza"),
// senão um "não caracteriza" quebrado em duas linhas seria lido como
// "caracteriza" sozinho e inverteria o resultado. Procura o padrão
// negativo com uma janela curta (até ~15 caracteres entre "não" e
// "caracteriz") antes do positivo, cobrindo variantes como "não se
// caracteriza", "não há caracterização de" — nenhum dos dois padrões
// encontrado = ambíguo (null), mais seguro que assumir um lado.
export function deriveInsalubre(conclusionExcerpt: string): boolean | null {
  const normalized = normalizeWhitespace(conclusionExcerpt).toLowerCase();
  if (/n[ãa]o[a-zà-ú\s]{0,15}caracteriz/.test(normalized) || normalized.includes('descaracteriza')) {
    return false;
  }
  if (normalized.includes('caracteriz')) {
    return true;
  }
  return null;
}
