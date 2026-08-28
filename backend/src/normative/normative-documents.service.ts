import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../documents/r2.service';

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
  constructor(private readonly r2: R2Service) {}

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
}
