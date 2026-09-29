import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../common/r2/r2.service';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import { splitIntoChunks } from '../common/chunking/chunking.util';
import { toVectorLiteral } from '../common/vector/vector.util';
import { extractPdfTextFull } from '../common/pdf/pdf-text.util';
import { verifyFileContent } from '../common/files/file-content.util';

export type ReferenceDocumentStatus = 'aguardando_validacao' | 'vigente' | 'rejeitado';

interface EmbeddedChunk {
  index: number;
  content: string;
  embedding: number[];
}

export interface ReferenceDocument {
  id: string;
  title: string;
  category: string;
  origin_note: string;
  status: ReferenceDocumentStatus;
  content_hash: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  raw_text: string;
  uploaded_by_user_id: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  indexed_at: string | null;
  created_at: string;
}

export interface CreateReferenceDocumentInput {
  title: string;
  category: string;
  originNote: string;
  file: { buffer: Buffer; mimetype: string; originalname: string };
  uploadedByUserId: string;
}

// Espelha NormativeDocumentsService (backend/src/normative/normative-documents.service.ts)
// pro ciclo de aprovação/indexação — mesmo raciocínio, mesmas garantias (ver
// docs/specs/documentos-referencia-sst.md). Diferenças: sem source_id/hash de
// nova-versão por fonte (não existe "fonte oficial" aqui), e create() extrai o
// texto do PDF na hora (não há monitor externo que já entregue o texto
// pronto).
@Injectable()
export class ReferenceDocumentsService {
  private readonly logger = new Logger(ReferenceDocumentsService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  async create(client: PoolClient, input: CreateReferenceDocumentInput): Promise<ReferenceDocument> {
    if (input.file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Só PDF é aceito para documento de referência');
    }
    const contentProblem = await verifyFileContent(input.file.buffer, input.file.mimetype);
    if (contentProblem) throw new BadRequestException(contentProblem);

    const text = await extractPdfTextFull(input.file.buffer);
    if (!text) {
      throw new BadRequestException(
        'Não foi possível extrair texto deste PDF (pode ser um documento escaneado sem texto real) — envie um PDF com texto pesquisável',
      );
    }

    const hash = createHash('sha256').update(text).digest('hex');
    const existing = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM reference_documents WHERE content_hash = $1 LIMIT 1',
      [hash],
    );
    if (existing.rows[0]) {
      throw new ConflictException(
        `Este documento já foi enviado antes (id ${existing.rows[0].id}, status ${existing.rows[0].status})`,
      );
    }

    const id = randomUUID();
    const fileKey = `reference/${id}/${input.file.originalname}`;
    await this.r2.putObject(fileKey, input.file.buffer, input.file.mimetype);

    const result = await client.query<ReferenceDocument>(
      `INSERT INTO reference_documents
         (id, title, category, origin_note, status, content_hash, file_key, file_name, mime_type, raw_text, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, 'aguardando_validacao', $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, input.title, input.category, input.originNote, hash, fileKey, input.file.originalname, input.file.mimetype, text, input.uploadedByUserId],
    );
    return result.rows[0];
  }

  async findOne(client: PoolClient, id: string): Promise<ReferenceDocument> {
    const result = await client.query<ReferenceDocument>('SELECT * FROM reference_documents WHERE id = $1', [id]);
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento de referência não encontrado');
    return document;
  }

  async findByStatus(client: PoolClient, status?: string): Promise<ReferenceDocument[]> {
    if (status) {
      const result = await client.query<ReferenceDocument>(
        'SELECT * FROM reference_documents WHERE status = $1 ORDER BY created_at DESC',
        [status],
      );
      return result.rows;
    }
    const result = await client.query<ReferenceDocument>('SELECT * FROM reference_documents ORDER BY created_at DESC');
    return result.rows;
  }

  async prepareApproval(client: PoolClient, documentId: string): Promise<ReferenceDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser aprovados');
    }
    return doc;
  }

  // Mesmo raciocínio de NormativeDocumentsService.computeEmbeddedChunks: SEM
  // nenhuma conexão de banco aberta, porque cada this.embeddings.embed() é
  // uma chamada HTTP externa lenta, uma por chunk.
  async computeEmbeddedChunks(rawText: string): Promise<EmbeddedChunk[]> {
    const chunks = splitIntoChunks(rawText);
    const embedded: EmbeddedChunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      embedded.push({ index: i, content: chunks[i], embedding: await this.embeddings.embed(chunks[i]) });
    }
    return embedded;
  }

  async finalizeApproval(
    client: PoolClient,
    documentId: string,
    reviewerUserId: string,
    embeddedChunks: EmbeddedChunk[],
  ): Promise<ReferenceDocument> {
    const doc = await this.findOne(client, documentId);
    // Mesma reconferência de NormativeDocumentsService.finalizeApproval: o
    // status pode ter mudado durante a janela de computeEmbeddedChunks
    // (chamada de embedding, segundos a minutos, sem lock).
    if (doc.status !== 'aguardando_validacao') {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — aprovação cancelada',
      );
    }
    const updated = await client.query(
      `UPDATE reference_documents
       SET status = 'vigente', reviewed_by_user_id = $2, reviewed_at = now()
       WHERE id = $1 AND status = 'aguardando_validacao'`,
      [documentId, reviewerUserId],
    );
    if (updated.rowCount === 0) {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — aprovação cancelada',
      );
    }

    await this.replaceChunks(client, documentId, embeddedChunks);
    return this.findOne(client, documentId);
  }

  async reject(client: PoolClient, documentId: string, reviewerUserId: string, reason: string): Promise<ReferenceDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser rejeitados');
    }
    await client.query(
      `UPDATE reference_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, reason],
    );
    return this.findOne(client, documentId);
  }

  async prepareReindex(client: PoolClient, documentId: string): Promise<ReferenceDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new BadRequestException('Só documentos vigentes podem ser reindexados');
    }
    return doc;
  }

  async finalizeReindex(client: PoolClient, documentId: string, embeddedChunks: EmbeddedChunk[]): Promise<ReferenceDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new ConflictException(
        'O status deste documento mudou enquanto a indexação estava em andamento — reindexação cancelada',
      );
    }
    await this.replaceChunks(client, documentId, embeddedChunks);
    return this.findOne(client, documentId);
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    if (document.status !== 'vigente') {
      throw new NotFoundException('Documento de referência não encontrado');
    }
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  // Mesmo padrão de SAVEPOINT de NormativeDocumentsService.replaceChunks: uma
  // falha de indexação nunca desfaz a aprovação/reindexação já aplicada —
  // ROLLBACK TO SAVEPOINT limpa só o trabalho parcial, sem abortar a
  // transação externa inteira.
  private async replaceChunks(client: PoolClient, documentId: string, embeddedChunks: EmbeddedChunk[]): Promise<void> {
    if (embeddedChunks.length === 0) {
      this.logger.error(
        `Documento de referência ${documentId} não gerou nenhum pedaço pra indexar — extração de texto provavelmente falhou`,
      );
      return;
    }

    await client.query('SAVEPOINT indexing');
    try {
      await client.query('DELETE FROM reference_document_chunks WHERE document_id = $1', [documentId]);
      for (const chunk of embeddedChunks) {
        await client.query(
          `INSERT INTO reference_document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [documentId, chunk.index, chunk.content, toVectorLiteral(chunk.embedding)],
        );
      }
      await client.query(`UPDATE reference_documents SET indexed_at = now() WHERE id = $1`, [documentId]);
      await client.query('RELEASE SAVEPOINT indexing');
    } catch (err) {
      this.logger.error(`Falha ao indexar documento de referência ${documentId}`, (err as Error).stack);
      await client.query('ROLLBACK TO SAVEPOINT indexing');
    }
  }
}
