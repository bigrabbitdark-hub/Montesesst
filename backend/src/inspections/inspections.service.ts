import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { CHECKLIST_ITEMS, ChecklistBlock } from './checklist-items.const';

export interface Inspection {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  technician_signature_at: string | null;
  company_signature_name: string | null;
  company_signature_at: string | null;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  inspection_id: string;
  block: ChecklistBlock;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

export interface ActionPlan {
  id: string;
  tenant_id: string;
  inspection_id: string;
  checklist_item_id: string | null;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
  created_at: string;
}

export interface InspectionDetail extends Inspection {
  items: ChecklistItem[];
  action_plans: ActionPlan[];
}

const INSPECTION_UPDATABLE_FIELDS = [
  'company_contact',
  'dds_topic',
  'dds_participants_count',
  'dds_notes',
  'general_recommendations',
  'technician_signature_name',
  'company_signature_name',
] as const;

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'notes'] as const;

@Injectable()
export class InspectionsService {
  async create(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
    visitedAt: string,
  ): Promise<InspectionDetail> {
    const inspectionResult = await client.query<Inspection>(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [tenantId, technicianUserId, visitedAt],
    );
    const inspection = inspectionResult.rows[0];

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const { block, item_key, item_label } of CHECKLIST_ITEMS) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(inspection.id, block, item_key, item_label);
    }
    const itemsResult = await client.query<ChecklistItem>(
      `INSERT INTO inspection_checklist_items (inspection_id, block, item_key, item_label)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );

    return { ...inspection, items: itemsResult.rows, action_plans: [] };
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Inspection[]> {
    if (tenantId) {
      const result = await client.query<Inspection>(
        'SELECT * FROM inspections WHERE tenant_id = $1 ORDER BY visited_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico vê tenants vinculados via EXISTS).
    const result = await client.query<Inspection>('SELECT * FROM inspections ORDER BY visited_at DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<InspectionDetail> {
    const inspectionResult = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
    const inspection = inspectionResult.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');

    const itemsResult = await client.query<ChecklistItem>(
      'SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 ORDER BY block, item_key',
      [id],
    );
    const actionPlansResult = await client.query<ActionPlan>(
      'SELECT * FROM action_plans WHERE inspection_id = $1 ORDER BY created_at',
      [id],
    );

    return { ...inspection, items: itemsResult.rows, action_plans: actionPlansResult.rows };
  }

  private async assertDraft(client: PoolClient, id: string): Promise<void> {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM inspections WHERE id = $1',
      [id],
    );
    const inspection = result.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');
    if (inspection.status !== 'rascunho') {
      throw new ConflictException('Inspeção já concluída — não pode mais ser editada');
    }
  }

  async update(client: PoolClient, id: string, data: Partial<Inspection>): Promise<Inspection> {
    await this.assertDraft(client, id);

    const { setClauses, values } = buildSafeSetClause(data, INSPECTION_UPDATABLE_FIELDS, 2);
    if ((data as any).technician_signature_name !== undefined) {
      setClauses.push('technician_signature_at = now()');
    }
    if ((data as any).company_signature_name !== undefined) {
      setClauses.push('company_signature_at = now()');
    }

    if (setClauses.length === 0) {
      const result = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
      return result.rows[0];
    }

    const result = await client.query<Inspection>(
      `UPDATE inspections SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  }

  async updateItem(
    client: PoolClient,
    inspectionId: string,
    itemId: string,
    data: Partial<ChecklistItem>,
  ): Promise<ChecklistItem> {
    await this.assertDraft(client, inspectionId);

    const { setClauses, values } = buildSafeSetClause(data, CHECKLIST_ITEM_UPDATABLE_FIELDS, 3);
    if (setClauses.length === 0) {
      const result = await client.query<ChecklistItem>(
        'SELECT * FROM inspection_checklist_items WHERE id = $1 AND inspection_id = $2',
        [itemId, inspectionId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException('Item de checklist não encontrado');
      return item;
    }

    const result = await client.query<ChecklistItem>(
      `UPDATE inspection_checklist_items SET ${setClauses.join(', ')}
       WHERE id = $1 AND inspection_id = $2 RETURNING *`,
      [itemId, inspectionId, ...values],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }
}
