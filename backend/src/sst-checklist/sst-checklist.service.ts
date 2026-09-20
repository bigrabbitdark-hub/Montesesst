import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../common/embedding/embedding-provider.interface';
import { toVectorLiteral } from '../common/vector/vector.util';
import { CreateSstChecklistItemDto } from './dto/create-sst-checklist-item.dto';
import { UpdateSstChecklistItemDto } from './dto/update-sst-checklist-item.dto';

export interface SstChecklistItem {
  id: string;
  nr_code: string;
  nr_title: string;
  nr_category: string;
  document_name: string;
  description: string;
  legal_requirement: string;
  infraction_index: number | null;
  is_fine_validated: boolean;
  created_at: string;
  updated_at: string;
}

// Nunca inclui a coluna `embedding` (vetor de 1536 floats) em nenhum
// SELECT/RETURNING deste serviço — não deve vazar pra resposta JSON de
// nenhum endpoint admin.
const COLUMNS =
  'id, nr_code, nr_title, nr_category, document_name, description, legal_requirement, infraction_index, is_fine_validated, created_at, updated_at';

// Precisa ficar IDÊNTICA à fórmula usada em db/embed-sst-checklist.ts —
// ver Global Constraints do plano.
function buildEmbeddingText(data: { nr_code: string; document_name: string; description: string; legal_requirement: string }): string {
  return `${data.nr_code} — ${data.document_name}: ${data.description} — ${data.legal_requirement}`;
}

@Injectable()
export class SstChecklistService {
  constructor(@Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider) {}

  async findAll(client: PoolClient, nrCode?: string): Promise<SstChecklistItem[]> {
    if (nrCode) {
      const result = await client.query<SstChecklistItem>(
        `SELECT ${COLUMNS} FROM sst_checklist_items WHERE nr_code = $1 ORDER BY document_name`,
        [nrCode],
      );
      return result.rows;
    }
    const result = await client.query<SstChecklistItem>(
      `SELECT ${COLUMNS} FROM sst_checklist_items ORDER BY nr_code, document_name`,
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<SstChecklistItem> {
    const result = await client.query<SstChecklistItem>(
      `SELECT ${COLUMNS} FROM sst_checklist_items WHERE id = $1`,
      [id],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }

  async create(client: PoolClient, dto: CreateSstChecklistItemDto): Promise<SstChecklistItem> {
    const vector = await this.embeddings.embed(buildEmbeddingText(dto));
    const result = await client.query<SstChecklistItem>(
      `INSERT INTO sst_checklist_items
         (nr_code, nr_title, nr_category, document_name, description, legal_requirement, infraction_index, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
       RETURNING ${COLUMNS}`,
      [
        dto.nr_code,
        dto.nr_title,
        dto.nr_category,
        dto.document_name,
        dto.description,
        dto.legal_requirement,
        dto.infraction_index ?? null,
        toVectorLiteral(vector),
      ],
    );
    return result.rows[0];
  }

  async update(client: PoolClient, id: string, dto: UpdateSstChecklistItemDto): Promise<SstChecklistItem> {
    const existing = await this.findOne(client, id);
    const merged = {
      nr_code: dto.nr_code ?? existing.nr_code,
      nr_title: dto.nr_title ?? existing.nr_title,
      nr_category: dto.nr_category ?? existing.nr_category,
      document_name: dto.document_name ?? existing.document_name,
      description: dto.description ?? existing.description,
      legal_requirement: dto.legal_requirement ?? existing.legal_requirement,
      infraction_index: dto.infraction_index !== undefined ? dto.infraction_index : existing.infraction_index,
    };

    // Só recalcula embedding se um dos 3 campos que entram no texto
    // embedado (ver buildEmbeddingText) realmente mudou — editar
    // infraction_index/nr_title/nr_category sozinho não precisa gastar
    // uma chamada de embedding.
    const needsReembedding =
      (dto.nr_code !== undefined && dto.nr_code !== existing.nr_code) ||
      (dto.document_name !== undefined && dto.document_name !== existing.document_name) ||
      (dto.description !== undefined && dto.description !== existing.description) ||
      (dto.legal_requirement !== undefined && dto.legal_requirement !== existing.legal_requirement);

    if (needsReembedding) {
      const vector = await this.embeddings.embed(buildEmbeddingText(merged));
      const result = await client.query<SstChecklistItem>(
        `UPDATE sst_checklist_items
         SET nr_code = $2, nr_title = $3, nr_category = $4, document_name = $5,
             description = $6, legal_requirement = $7, infraction_index = $8, embedding = $9::vector
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [
          id,
          merged.nr_code,
          merged.nr_title,
          merged.nr_category,
          merged.document_name,
          merged.description,
          merged.legal_requirement,
          merged.infraction_index,
          toVectorLiteral(vector),
        ],
      );
      return result.rows[0];
    }

    const result = await client.query<SstChecklistItem>(
      `UPDATE sst_checklist_items
       SET nr_code = $2, nr_title = $3, nr_category = $4, document_name = $5,
           description = $6, legal_requirement = $7, infraction_index = $8
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        merged.nr_code,
        merged.nr_title,
        merged.nr_category,
        merged.document_name,
        merged.description,
        merged.legal_requirement,
        merged.infraction_index,
      ],
    );
    return result.rows[0];
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    await this.findOne(client, id);
    await client.query('DELETE FROM sst_checklist_items WHERE id = $1', [id]);
  }
}
