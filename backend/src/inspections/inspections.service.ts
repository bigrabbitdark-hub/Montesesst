import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { CHECKLIST_ITEMS, ChecklistBlock } from './checklist-items.const';
import { DocumentsService } from '../documents/documents.service';
import { buildInspectionPdf, toDateString } from './inspection-pdf.util';

export interface Inspection {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_unit_id: string | null;
  started_at: string | null;
  ended_at: string | null;
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
  tenant_cnpj: string;
  company_unit_address: string | null;
}

const INSPECTION_UPDATABLE_FIELDS = [
  'company_contact',
  'dds_topic',
  'dds_participants_count',
  'dds_notes',
  'general_recommendations',
  'technician_signature_name',
  'company_signature_name',
  'started_at',
  'ended_at',
] as const;

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'notes'] as const;
const ACTION_PLAN_UPDATABLE_FIELDS = ['deadline', 'responsible', 'status'] as const;

@Injectable()
export class InspectionsService {
  constructor(private readonly documents: DocumentsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  private async resolveIdentification(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string | null,
  ): Promise<{ tenant_cnpj: string; company_unit_address: string | null }> {
    const tenantResult = await client.query<{ cnpj: string }>('SELECT cnpj FROM tenants WHERE id = $1', [tenantId]);

    let companyUnitAddress: string | null = null;
    if (companyUnitId) {
      const unitResult = await client.query<{
        address_street: string;
        address_number: string | null;
        address_city: string;
        address_state: string;
      }>(
        'SELECT address_street, address_number, address_city, address_state FROM company_units WHERE id = $1',
        [companyUnitId],
      );
      const unit = unitResult.rows[0];
      if (unit) {
        companyUnitAddress = `${unit.address_street}${unit.address_number ? `, ${unit.address_number}` : ''} — ${unit.address_city}/${unit.address_state}`;
      }
    }

    return { tenant_cnpj: tenantResult.rows[0].cnpj, company_unit_address: companyUnitAddress };
  }

  async create(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
    visitedAt: string,
    companyUnitId: string,
    startedAt: string | undefined,
    endedAt: string | undefined,
  ): Promise<InspectionDetail> {
    await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);

    try {
      const inspectionResult = await client.query<Inspection>(
        `INSERT INTO inspections (tenant_id, technician_user_id, visited_at, company_unit_id, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, technicianUserId, visitedAt, companyUnitId, startedAt ?? null, endedAt ?? null],
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

      // Reaproveita resolveIdentification (mesma lógica de findOne) em
      // vez de devolver tenant_cnpj/company_unit_address vazios só pra
      // satisfazer o tipo — o frontend não usa esses 2 campos da
      // resposta de create() hoje (navega direto pra tela de detalhe,
      // que já busca tudo de novo via findOne), mas devolver um valor
      // estruturalmente errado (string vazia) é pior que uma query a
      // mais, que já ia acontecer de qualquer forma segundos depois.
      const identification = await this.resolveIdentification(client, tenantId, companyUnitId);

      return {
        ...inspection,
        items: itemsResult.rows,
        action_plans: [],
        ...identification,
      };
    } catch (err) {
      mapPgError(err);
    }
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
    // tenant, técnico vê tenants vinculados via EXISTS contra tenant_technicians,
    // parceiro vê tenants vinculados via EXISTS contra tenant_partners).
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
    const identification = await this.resolveIdentification(client, inspection.tenant_id, inspection.company_unit_id);

    return { ...inspection, ...identification, items: itemsResult.rows, action_plans: actionPlansResult.rows };
  }

  private async assertDraft(client: PoolClient, id: string): Promise<void> {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM inspections WHERE id = $1 FOR UPDATE',
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

  async conclude(client: PoolClient, id: string, userId: string, userRole: 'tecnico' | 'parceiro'): Promise<InspectionDetail> {
    await this.assertDraft(client, id);

    const updateResult = await client.query<{ tenant_id: string }>(
      `UPDATE inspections SET status = 'concluida', concluded_at = now() WHERE id = $1 RETURNING tenant_id`,
      [id],
    );
    const tenantId = updateResult.rows[0].tenant_id;

    const ncItemsResult = await client.query<ChecklistItem>(
      `SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 AND status = 'NC'`,
      [id],
    );

    for (const item of ncItemsResult.rows) {
      await client.query(
        `INSERT INTO action_plans (tenant_id, inspection_id, checklist_item_id, description)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, id, item.id, item.item_label],
      );
    }

    const detail = await this.findOne(client, id);

    try {
      const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
        detail.tenant_id,
      ]);
      const pdfBuffer = await buildInspectionPdf(detail, {
        tenantName: tenantResult.rows[0].name,
        tenantCnpj: detail.tenant_cnpj,
        companyUnitAddress: detail.company_unit_address,
      });
      await this.documents.upload(client, {
        tenantId: detail.tenant_id,
        category: 'relatorio_visita',
        // detail.visited_at é coluna DATE — mesma armadilha de serialização
        // documentada em inspection-pdf.util.ts (e em várias fases
        // anteriores deste projeto); sem normalizar aqui o título vinha como
        // "Relatório de Visita — Tue Sep 15 2026 00:00:00 GMT..." em vez de
        // "Relatório de Visita — 2026-09-15" (achado real rodando o teste
        // e2e desta task, não estava no bloco original comentado da Task 1).
        title: `Relatório de Visita — ${toDateString(detail.visited_at)}`,
        file: {
          buffer: pdfBuffer,
          mimetype: 'application/pdf',
          originalname: `relatorio-visita-${detail.id.slice(0, 8)}.pdf`,
          size: pdfBuffer.length,
        },
        uploadedByUserId: userId,
        uploadedByRole: userRole,
        companyUnitId: detail.company_unit_id ?? undefined,
      });
    } catch (err) {
      // Nunca derruba a conclusão da inspeção por causa do PDF.
      console.warn(`Falha ao gerar/indexar PDF da inspeção ${id}: ${(err as Error).message}`);
    }

    return detail;
  }

  async findActionPlans(client: PoolClient, tenantId?: string): Promise<ActionPlan[]> {
    if (tenantId) {
      const result = await client.query<ActionPlan>(
        'SELECT * FROM action_plans WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<ActionPlan>('SELECT * FROM action_plans ORDER BY created_at DESC');
    return result.rows;
  }

  async updateActionPlan(client: PoolClient, id: string, data: Partial<ActionPlan>): Promise<ActionPlan> {
    const { setClauses, values } = buildSafeSetClause(data, ACTION_PLAN_UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) {
      const result = await client.query<ActionPlan>('SELECT * FROM action_plans WHERE id = $1', [id]);
      const plan = result.rows[0];
      if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
      return plan;
    }
    const result = await client.query<ActionPlan>(
      `UPDATE action_plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
    return plan;
  }
}
