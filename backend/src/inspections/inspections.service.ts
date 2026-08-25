import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
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
}
