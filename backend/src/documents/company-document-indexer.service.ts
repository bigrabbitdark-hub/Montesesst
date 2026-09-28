import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import { splitIntoChunks, groupLinesIntoChunks } from '../common/chunking/chunking.util';
import { toVectorLiteral } from '../common/vector/vector.util';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { redactPii } from '../common/text/pii-redaction.util';
import { Document } from './documents.service';

const INDEXABLE_CATEGORIES = ['pgr', 'pcmso', 'ltcat', 'lip'];
const INDEXABLE_MIME_TYPES = ['application/pdf', DOCX_MIME_TYPE, XLSX_MIME_TYPE];

// Teto de pedaços por documento — sem isso, um PDF/DOCX/XLSX muito grande
// podia gerar centenas de chamadas de embedding sequenciais dentro da
// mesma requisição de upload (spec §2 não previu limite nenhum). 500 é
// generoso pro caso comum (um PGR/PCMSO típico fica na casa de dezenas de
// pedaços) e ainda barato o bastante pra não expor a rota a custo de API
// desproporcional por upload. Achado #3 da revisão final da Fase 24.
const MAX_CHUNKS_PER_DOCUMENT = 500;

// Mesmo padrão/valor de BATCH_TIME_BUDGET_MS em documents.controller.ts:
// 240s de folga segura sob o proxy_read_timeout de 300s do nginx
// (nginx/conf.d/default.conf) — sem isso, um documento com muitos pedaços
// sob degradação do provedor de embedding podia estourar o proxy antes da
// resposta do upload chegar ao cliente. Achado #3 da revisão final da
// Fase 24.
const EMBEDDING_TIME_BUDGET_MS = 240_000;

export interface EmbeddedDocumentChunk {
  chunkIndex: number;
  content: string;
  embedding: number[];
}

@Injectable()
export class CompanyDocumentIndexerService {
  private readonly logger = new Logger(CompanyDocumentIndexerService.name);

  constructor(@Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider) {}

  shouldIndex(category: string, mimeType: string): boolean {
    return INDEXABLE_CATEGORIES.includes(category) && INDEXABLE_MIME_TYPES.includes(mimeType);
  }

  // Extração + chunking + embedding, SEM nenhum PoolClient — cada
  // this.embeddings.embed() é uma chamada HTTP externa (~segundos,
  // sequencial por chunk); rodar isso fora de qualquer client do pool é o
  // ponto central do Finding #1 da revisão final da Fase 24 (recriava o
  // Finding C1a da Fase 9: a versão antiga de indexDocument segurava uma
  // conexão do pool presa durante todo este laço). Mesmo padrão de
  // NormativeDocumentsService.computeEmbeddedChunks.
  //
  // Nunca lança exceção — mesma garantia do antigo indexDocument: falha de
  // extração/chunking/embedding é logada e engolida aqui, porque o upload
  // do documento (já commitado antes desta chamada, ver DocumentsController)
  // nunca pode ser derrubado por uma falha de indexação (spec §2,
  // "non-blocking").
  // ITEM 003 (auditoria 2026-09-27): `knownFullNames` é a lista de nomes de
  // funcionários já cadastrados no tenant (buscada pelo chamador, que tem o
  // PoolClient — este método deliberadamente não tem um, ver comentário
  // acima) — cada pedaço é minimizado (CPF + nomes conhecidos) ANTES de
  // embutido (chamada externa ao provedor de embedding) e antes de
  // devolvido pro chamador persistir, porque o mesmo `content` também é
  // reenviado depois no prompt do Assistente (normative-answer-shared.ts) —
  // uma única redação aqui cobre os dois pontos de saída pro provedor
  // externo de IA. Documento indexado ANTES desta mudança permanece sem
  // redação (não há reindexação retroativa nesta correção).
  async extractAndEmbed(
    document: Document,
    fileBuffer: Buffer,
    knownFullNames: string[] = [],
  ): Promise<EmbeddedDocumentChunk[]> {
    try {
      const rawChunks = await this.extractChunks(document.mime_type, fileBuffer);
      if (rawChunks.length === 0) return [];
      const chunks = rawChunks.map((chunk) => redactPii(chunk, knownFullNames));

      let truncatedChunks = chunks;
      if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
        truncatedChunks = chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT);
        this.logger.warn(
          `Documento ${document.id} gerou ${chunks.length} pedaços — truncado para ${MAX_CHUNKS_PER_DOCUMENT}, ${
            chunks.length - MAX_CHUNKS_PER_DOCUMENT
          } descartados (indexação parcial)`,
        );
      }

      const embedded: EmbeddedDocumentChunk[] = [];
      const startedAt = Date.now();
      for (let i = 0; i < truncatedChunks.length; i++) {
        if (Date.now() - startedAt > EMBEDDING_TIME_BUDGET_MS) {
          this.logger.warn(
            `Orçamento de tempo de embedding excedido pro documento ${document.id} — indexados ${embedded.length} de ${truncatedChunks.length} pedaços (indexação parcial)`,
          );
          break;
        }
        const embedding = await this.embeddings.embed(truncatedChunks[i]);
        embedded.push({ chunkIndex: i, content: truncatedChunks[i], embedding });
      }
      return embedded;
    } catch (err) {
      this.logger.warn(`Falha ao extrair/gerar embeddings do documento ${document.id}: ${(err as Error).message}`);
      return [];
    }
  }

  // Só o INSERT dos pedaços JÁ embutidos (embedded) — nenhuma chamada HTTP
  // externa aqui, só SQL, por isso é seguro segurar o PoolClient durante
  // este método: agora é rápido (só escrita em banco) e breve. Nunca lança
  // exceção — mesma razão do antigo indexDocument: uma falha parcial de
  // INSERT aqui não pode derrubar o upload já commitado. Se um INSERT no
  // meio do laço falhar, a transação (dedicada só a isto, ver
  // DocumentsController) fica abortada e o COMMIT do chamador vira um
  // rollback implícito — nenhum pedaço parcial fica persistido, o que é o
  // comportamento correto (tudo ou nada) já que não há mais nada de
  // relevante nesta transação pra proteger.
  async persistChunks(client: PoolClient, document: Document, embeddedChunks: EmbeddedDocumentChunk[]): Promise<void> {
    if (embeddedChunks.length === 0) return;
    try {
      for (const chunk of embeddedChunks) {
        await client.query(
          `INSERT INTO company_document_chunks (tenant_id, document_id, category, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [
            document.tenant_id,
            document.id,
            document.category,
            chunk.chunkIndex,
            chunk.content,
            toVectorLiteral(chunk.embedding),
          ],
        );
      }
    } catch (err) {
      this.logger.warn(`Falha ao persistir chunks do documento ${document.id}: ${(err as Error).message}`);
    }
  }

  // Extrai o texto (dispatch por mimetype) e devolve os pedaços já
  // quebrados na estratégia certa pro tipo de conteúdo: XLSX usa
  // groupLinesIntoChunks (cada linha da planilha já é uma unidade de
  // sentido completa, nunca pode ser cortada no meio — Finding #6 da
  // revisão final da Fase 24); PDF/DOCX continuam em splitIntoChunks
  // (texto corrido, cortar por tamanho de caractere é correto ali).
  private async extractChunks(mimeType: string, buffer: Buffer): Promise<string[]> {
    if (mimeType === 'application/pdf') {
      const text = await extractPdfTextFull(buffer);
      return text ? splitIntoChunks(text) : [];
    }
    if (mimeType === DOCX_MIME_TYPE) {
      const text = await extractDocxText(buffer);
      return text ? splitIntoChunks(text) : [];
    }
    if (mimeType === XLSX_MIME_TYPE) {
      const rows = await extractXlsxRows(buffer);
      return rows.length > 0 ? groupLinesIntoChunks(rows) : [];
    }
    return [];
  }
}
