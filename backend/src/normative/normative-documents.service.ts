import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../documents/r2.service';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider.interface';
import { splitIntoChunks } from './chunking.util';
import { toVectorLiteral } from './vector.util';

export type NormativeDocumentStatus = 'aguardando_validacao' | 'vigente' | 'rejeitado' | 'substituido';

export interface NormativeDocument {
  id: string;
  source_id: string;
  status: NormativeDocumentStatus;
  content_hash: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  raw_text: string;
  detected_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  supersedes_document_id: string | null;
  indexed_at: string | null;
  created_at: string;
}

@Injectable()
export class NormativeDocumentsService {
  private readonly logger = new Logger(NormativeDocumentsService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  // Compara com a linha MAIS RECENTE da fonte, qualquer status — não só
  // `vigente` (correção sobre a spec seção 4.2, ver Global Constraints
  // do plano). Comparar só com `vigente` recriaria uma linha
  // `aguardando_validacao` duplicada a cada execução do monitor enquanto
  // a mesma versão ficasse pendente de revisão ou já rejeitada.
  async recordDetectedVersion(
    client: PoolClient,
    sourceId: string,
    text: string,
    fileBuffer: Buffer,
    mimeType: string,
    sourceUrl: string,
  ): Promise<NormativeDocument | null> {
    const hash = createHash('sha256').update(text).digest('hex');

    const mostRecent = await client.query<{ content_hash: string }>(
      `SELECT content_hash FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceId],
    );
    if (mostRecent.rows[0]?.content_hash === hash) {
      return null;
    }

    const id = randomUUID();
    const fileName = sourceUrl.split('/').pop() || 'documento';
    const fileKey = `normative/${sourceId}/${id}/${fileName}`;
    await this.r2.putObject(fileKey, fileBuffer, mimeType);

    const result = await client.query<NormativeDocument>(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'aguardando_validacao', $3, $4, $5, $6, $7) RETURNING *`,
      [id, sourceId, hash, fileKey, fileName, mimeType, text],
    );
    return result.rows[0];
  }

  async findOne(client: PoolClient, id: string): Promise<NormativeDocument> {
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents WHERE id = $1',
      [id],
    );
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento normativo não encontrado');
    return document;
  }

  async findByStatus(client: PoolClient, status?: string): Promise<NormativeDocument[]> {
    if (status) {
      const result = await client.query<NormativeDocument>(
        'SELECT * FROM normative_documents WHERE status = $1 ORDER BY detected_at DESC',
        [status],
      );
      return result.rows;
    }
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents ORDER BY detected_at DESC',
    );
    return result.rows;
  }

  async findOneWithPrevious(
    client: PoolClient,
    id: string,
  ): Promise<{ document: NormativeDocument; previous_text: string | null }> {
    const document = await this.findOne(client, id);
    const previous = await client.query<{ raw_text: string }>(
      `SELECT raw_text FROM normative_documents WHERE source_id = $1 AND status = 'vigente' AND id != $2`,
      [document.source_id, id],
    );
    return { document, previous_text: previous.rows[0]?.raw_text ?? null };
  }

  async approve(client: PoolClient, documentId: string, reviewerUserId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser aprovados');
    }

    const previous = await client.query<{ id: string }>(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
      [doc.source_id],
    );
    const previousId = previous.rows[0]?.id ?? null;

    if (previousId) {
      await client.query(`UPDATE normative_documents SET status = 'substituido' WHERE id = $1`, [previousId]);
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'vigente', reviewed_by_user_id = $2, reviewed_at = now(), supersedes_document_id = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, previousId],
    );

    await this.indexDocument(client, documentId, doc.raw_text);

    return this.findOne(client, documentId);
  }

  async reject(client: PoolClient, documentId: string, reviewerUserId: string, reason: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser rejeitados');
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, reason],
    );
    return this.findOne(client, documentId);
  }

  async reindex(client: PoolClient, documentId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new BadRequestException('Só documentos vigentes podem ser reindexados');
    }
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('UPDATE normative_documents SET indexed_at = NULL WHERE id = $1', [documentId]);
    await this.indexDocument(client, documentId, doc.raw_text);
    return this.findOne(client, documentId);
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    if (document.status !== 'vigente') {
      throw new NotFoundException('Documento normativo não encontrado');
    }
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  // Nunca deixa uma falha de indexação desfazer a aprovação — o
  // try/catch fica dentro deste método (não propaga), senão o
  // withTenantContext do controller reverteria a transação inteira,
  // inclusive a troca de status já aplicada acima. `indexed_at`
  // simplesmente continua NULL (ver Global Constraints do plano).
  //
  // Isso sozinho NÃO basta pra falhas de SQL (ex.: embedding com
  // dimensão errada pro `vector(1536)`, violação de constraint): o
  // Postgres aborta a transação inteira no erro (25P02), e qualquer
  // comando seguinte no mesmo client — inclusive o `findOne` que
  // `approve`/`reindex` chamam depois — falha com "current transaction
  // is aborted", propagando pra fora e derrubando o withTenantContext
  // (rollback da transação inteira, desfazendo a troca de status já
  // aplicada). Por isso o SAVEPOINT: ROLLBACK TO SAVEPOINT desfaz só o
  // trabalho de indexação parcial e limpa o estado abortado, deixando a
  // transação externa livre pra prosseguir e commitar normalmente.
  private async indexDocument(client: PoolClient, documentId: string, rawText: string): Promise<void> {
    await client.query('SAVEPOINT indexing');
    try {
      const chunks = splitIntoChunks(rawText);
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.embeddings.embed(chunks[i]);
        await client.query(
          `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [documentId, i, chunks[i], toVectorLiteral(embedding)],
        );
      }
      await client.query(`UPDATE normative_documents SET indexed_at = now() WHERE id = $1`, [documentId]);
      await client.query('RELEASE SAVEPOINT indexing');
    } catch (err) {
      this.logger.error(`Falha ao indexar documento ${documentId}`, (err as Error).stack);
      await client.query('ROLLBACK TO SAVEPOINT indexing');
    }
  }
}
