import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { R2Service } from './r2.service';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ALLOWED_CATEGORIES = ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento'];

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
    const fileKey = `tenants/${data.tenantId}/documents/${id}/${data.file.originalname}`;
    await this.r2.putObject(fileKey, data.file.buffer, data.file.mimetype);

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

  async findOne(client: PoolClient, id: string): Promise<Document> {
    const result = await client.query<Document>('SELECT * FROM documents WHERE id = $1', [id]);
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento não encontrado');
    return document;
  }
}
