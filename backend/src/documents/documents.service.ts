import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { R2Service } from './r2.service';
import { mapPgError } from '../common/pg-error.util';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ALLOWED_CATEGORIES = ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento'];

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface Document {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string | null;
  uploaded_by_user_id: string;
  uploaded_by_role: string;
  created_at: string;
  updated_at: string;
}

export interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

export interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface UploadData {
  tenantId: string;
  category: string;
  title: string;
  expiresAt?: string;
  file: UploadFile;
  uploadedByUserId: string;
  uploadedByRole: 'empresa' | 'tecnico';
}

@Injectable()
export class DocumentsService {
  constructor(private readonly r2: R2Service) {}

  async upload(client: PoolClient, data: UploadData): Promise<Document> {
    if (!ALLOWED_MIME_TYPES.includes(data.file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só PDF, JPG ou PNG)');
    }
    if (!ALLOWED_CATEGORIES.includes(data.category)) {
      throw new BadRequestException('Categoria inválida');
    }

    const id = randomUUID();
    const fileKey = `tenants/${data.tenantId}/documents/${id}/${sanitizeFileName(data.file.originalname)}`;
    await this.r2.putObject(fileKey, data.file.buffer, data.file.mimetype);

    try {
      const result = await client.query<Document>(
        `INSERT INTO documents (id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          id,
          data.tenantId,
          data.category,
          data.title,
          fileKey,
          data.file.originalname,
          data.file.mimetype,
          data.file.size,
          data.expiresAt ?? null,
          data.uploadedByUserId,
          data.uploadedByRole,
        ],
      );
      return result.rows[0];
    } catch (err) {
      // O objeto já foi gravado no R2 real antes do INSERT — se o INSERT
      // falhar (ex: RLS rejeitando um técnico não vinculado ao tenant),
      // sem isso o objeto ficaria órfão no bucket pra sempre.
      try {
        await this.r2.deleteObject(fileKey);
      } catch {
        // Best-effort: não deixa uma falha na limpeza mascarar o erro
        // real do INSERT, que é o que o caller precisa ver.
      }
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Document[]> {
    if (tenantId) {
      const result = await client.query<Document>(
        'SELECT * FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico vê tenants vinculados via EXISTS).
    const result = await client.query<Document>('SELECT * FROM documents ORDER BY created_at DESC');
    return result.rows;
  }

  async getCompliance(client: PoolClient, tenantId?: string): Promise<ComplianceResult> {
    const rows = tenantId
      ? (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL AND tenant_id = $1
             ORDER BY expires_at ASC`,
            [tenantId],
          )
        ).rows
      : (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL
             ORDER BY expires_at ASC`,
          )
        ).rows;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendencias: ComplianceItem[] = [];
    const avisos: ComplianceItem[] = [];
    let emDiaCount = 0;

    for (const row of rows) {
      const expiresAt = new Date(row.expires_at);
      expiresAt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        pendencias.push({ ...row, dias_vencido: -diffDays });
      } else if (diffDays <= 30) {
        avisos.push({ ...row, dias_restantes: diffDays });
        emDiaCount++;
      } else {
        emDiaCount++;
      }
    }

    const score = rows.length === 0 ? null : Math.round((emDiaCount / rows.length) * 100);
    return { score, pendencias, avisos };
  }

  async findOne(client: PoolClient, id: string): Promise<Document> {
    const result = await client.query<Document>('SELECT * FROM documents WHERE id = $1', [id]);
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento não encontrado');
    return document;
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  async remove(client: PoolClient, id: string, userId: string, isAdmin: boolean): Promise<void> {
    const document = await this.findOne(client, id);
    if (!isAdmin && document.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('Só quem subiu o documento pode apagá-lo');
    }
    await this.r2.deleteObject(document.file_key);
    const result = await client.query('DELETE FROM documents WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Documento não encontrado');
  }
}
