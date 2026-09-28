import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';
import { IMAGE_MIME_TYPES, verifyFileContent } from '../common/files/file-content.util';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';
import { PREVENTION_CHECKLIST_ITEMS } from './prevention-checklist-items.const';

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface PreventionChecklist {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreventionChecklistItem {
  id: string;
  checklist_id: string;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  observacoes: string | null;
  foto_r2_key: string | null;
}

export interface PreventionChecklistDetail extends PreventionChecklist {
  items: PreventionChecklistItem[];
}

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'observacoes'] as const;

@Injectable()
export class PreventionChecklistService {
  constructor(
    private readonly r2: R2Service,
    private readonly correctiveActions: PreventionCorrectiveActionsService,
  ) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  private async assertDraft(client: PoolClient, id: string): Promise<{ tenant_id: string }> {
    const result = await client.query<{ status: string; tenant_id: string }>(
      'SELECT status, tenant_id FROM prevention_checklists WHERE id = $1 FOR UPDATE',
      [id],
    );
    const checklist = result.rows[0];
    if (!checklist) throw new NotFoundException('Checklist não encontrado');
    if (checklist.status !== 'rascunho') {
      throw new ConflictException('Checklist já concluído — não pode mais ser editado');
    }
    return checklist;
  }

  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    technicianUserId: string,
    dataRealizacao: string,
  ): Promise<PreventionChecklistDetail> {
    await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);

    try {
      const checklistResult = await client.query<PreventionChecklist>(
        `INSERT INTO prevention_checklists (tenant_id, company_unit_id, technician_user_id, data_realizacao)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, companyUnitId, technicianUserId, dataRealizacao],
      );
      const checklist = checklistResult.rows[0];

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const { item_key, item_label } of PREVENTION_CHECKLIST_ITEMS) {
        values.push(`($${i++}, $${i++}, $${i++})`);
        params.push(checklist.id, item_key, item_label);
      }
      const itemsResult = await client.query<PreventionChecklistItem>(
        `INSERT INTO prevention_checklist_items (checklist_id, item_key, item_label)
         VALUES ${values.join(', ')} RETURNING *`,
        params,
      );

      return { ...checklist, items: itemsResult.rows };
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<PreventionChecklist[]> {
    if (tenantId) {
      const result = await client.query<PreventionChecklist>(
        'SELECT * FROM prevention_checklists WHERE tenant_id = $1 ORDER BY data_realizacao DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<PreventionChecklist>(
      'SELECT * FROM prevention_checklists ORDER BY data_realizacao DESC',
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<PreventionChecklistDetail> {
    const checklistResult = await client.query<PreventionChecklist>(
      'SELECT * FROM prevention_checklists WHERE id = $1',
      [id],
    );
    const checklist = checklistResult.rows[0];
    if (!checklist) throw new NotFoundException('Checklist não encontrado');

    const itemsResult = await client.query<PreventionChecklistItem>(
      'SELECT * FROM prevention_checklist_items WHERE checklist_id = $1 ORDER BY item_key',
      [id],
    );
    return { ...checklist, items: itemsResult.rows };
  }

  async updateItem(
    client: PoolClient,
    checklistId: string,
    itemId: string,
    data: { status?: string; observacoes?: string },
  ): Promise<PreventionChecklistItem> {
    await this.assertDraft(client, checklistId);

    const { setClauses, values } = buildSafeSetClause(data, CHECKLIST_ITEM_UPDATABLE_FIELDS, 3);
    if (setClauses.length === 0) {
      const result = await client.query<PreventionChecklistItem>(
        'SELECT * FROM prevention_checklist_items WHERE id = $1 AND checklist_id = $2',
        [itemId, checklistId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException('Item de checklist não encontrado');
      return item;
    }

    const result = await client.query<PreventionChecklistItem>(
      `UPDATE prevention_checklist_items SET ${setClauses.join(', ')}
       WHERE id = $1 AND checklist_id = $2 RETURNING *`,
      [itemId, checklistId, ...values],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }

  async uploadItemPhoto(
    client: PoolClient,
    checklistId: string,
    itemId: string,
    file: Express.Multer.File,
  ): Promise<PreventionChecklistItem> {
    // ITEM 004: este endpoint não validava tipo nenhum (ver fire-safety-equipment).
    if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só JPG ou PNG)');
    }
    const contentProblem = await verifyFileContent(file.buffer, file.mimetype);
    if (contentProblem) throw new BadRequestException(contentProblem);

    const { tenant_id: tenantId } = await this.assertDraft(client, checklistId);

    const itemCheck = await client.query('SELECT id FROM prevention_checklist_items WHERE id = $1 AND checklist_id = $2', [
      itemId,
      checklistId,
    ]);
    if (itemCheck.rowCount === 0) throw new NotFoundException('Item de checklist não encontrado');

    const fileKey = `tenants/${tenantId}/prevention-checklists/${checklistId}/${itemId}/${sanitizeFileName(file.originalname)}`;
    await this.r2.putObject(fileKey, file.buffer, file.mimetype);

    const result = await client.query<PreventionChecklistItem>(
      'UPDATE prevention_checklist_items SET foto_r2_key = $2 WHERE id = $1 RETURNING *',
      [itemId, fileKey],
    );
    return result.rows[0];
  }

  async getItemFotoUrl(client: PoolClient, checklistId: string, itemId: string): Promise<{ url: string }> {
    const result = await client.query<PreventionChecklistItem>(
      'SELECT * FROM prevention_checklist_items WHERE id = $1 AND checklist_id = $2',
      [itemId, checklistId],
    );
    const item = result.rows[0];
    if (!item || !item.foto_r2_key) throw new NotFoundException('Nenhuma foto cadastrada pra esse item');
    const url = await this.r2.getPresignedDownloadUrl(item.foto_r2_key);
    return { url };
  }

  async concluir(client: PoolClient, id: string): Promise<PreventionChecklistDetail> {
    const { tenant_id: tenantId } = await this.assertDraft(client, id);

    await client.query(`UPDATE prevention_checklists SET status = 'concluida', concluded_at = now() WHERE id = $1`, [
      id,
    ]);

    const ncItemsResult = await client.query<PreventionChecklistItem>(
      `SELECT * FROM prevention_checklist_items WHERE checklist_id = $1 AND status = 'NC'`,
      [id],
    );
    for (const item of ncItemsResult.rows) {
      await this.correctiveActions.create(client, {
        tenantId,
        checklistItemId: item.id,
        description: item.item_label,
      });
    }

    return this.findOne(client, id);
  }
}
