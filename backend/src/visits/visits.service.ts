import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';

export interface VisitRequest {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  requested_by_user_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  preferred_date: string | null;
  confirmed_date: string | null;
  motivo: string | null;
  inspection_id: string | null;
  created_at: string;
  updated_at: string;
}

// Colunas `date` do Postgres chegam via node-pg como objeto Date (não
// string); ao passar por JSON.stringify na resposta HTTP, Date.toJSON()
// serializa como datetime UTC completo ('2026-09-12T00:00:00.000Z'), não
// 'YYYY-MM-DD'. Mesmo padrão de normalização usado em
// dashboard.service.ts (toDateString) — aplicado aqui a preferred_date/
// confirmed_date antes de qualquer VisitRequest sair pro controller.
export function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

export function normalizeVisit(row: VisitRequest): VisitRequest {
  return {
    ...row,
    preferred_date: toDateString(row.preferred_date),
    confirmed_date: toDateString(row.confirmed_date),
  };
}

@Injectable()
export class VisitsService {
  async create(
    client: PoolClient,
    tenantId: string,
    requestedByUserId: string,
    technicianUserId: string,
    preferredDate: string | undefined,
    motivo: string | undefined,
  ): Promise<VisitRequest> {
    const linked = await this.isTechnicianLinked(client, tenantId, technicianUserId);
    if (!linked) {
      throw new ForbiddenException('Técnico não está vinculado a esta empresa');
    }

    const result = await client.query<VisitRequest>(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, preferred_date, motivo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, technicianUserId, requestedByUserId, preferredDate ?? null, motivo ?? null],
    );
    return normalizeVisit(result.rows[0]);
  }

  async findAll(client: PoolClient, user: AuthenticatedUser): Promise<VisitRequest[]> {
    if (user.role === 'admin') {
      // Sem filtro: a RLS de visit_requests já concede visibilidade total
      // pra admin (current_setting('app.role', true) = 'admin' no
      // primeiro branch da policy) — mesmo padrão de
      // InspectionsService.findAll quando nenhum tenantId é passado.
      const result = await client.query<VisitRequest>(
        `SELECT * FROM visit_requests
         ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
      );
      return result.rows.map(normalizeVisit);
    }
    if (user.role === 'empresa') {
      const result = await client.query<VisitRequest>(
        `SELECT * FROM visit_requests WHERE tenant_id = $1
         ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
        [user.tenantId],
      );
      return result.rows.map(normalizeVisit);
    }
    // técnico/parceiro: RLS já restringe às empresas vinculadas; aqui filtra
    // pelas visitas atribuídas especificamente a este usuário.
    const result = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests WHERE technician_user_id = $1
       ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
      [user.id],
    );
    return result.rows.map(normalizeVisit);
  }

  async confirm(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    confirmedDate: string,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode confirmar esta visita');
    }
    if (visit.status !== 'solicitado') {
      throw new ConflictException('Visita não está aguardando confirmação');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'confirmado', confirmed_date = $2 WHERE id = $1 RETURNING *`,
      [id, confirmedDate],
    );
    return normalizeVisit(result.rows[0]);
  }

  async cancel(client: PoolClient, id: string, user: AuthenticatedUser): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    // RLS já restringe o que é visível: se `user` é empresa e a linha
    // apareceu aqui, é necessariamente do próprio tenant dela.
    const isOwnerEmpresa = user.role === 'empresa';
    const isAssignedTechnician =
      (user.role === 'tecnico' || user.role === 'parceiro') && visit.technician_user_id === user.id;
    if (!isOwnerEmpresa && !isAssignedTechnician) {
      throw new ForbiddenException('Sem permissão para cancelar esta visita');
    }
    if (visit.status !== 'solicitado' && visit.status !== 'confirmado') {
      throw new ConflictException('Visita não pode mais ser cancelada');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'cancelado' WHERE id = $1 RETURNING *`,
      [id],
    );
    return normalizeVisit(result.rows[0]);
  }

  async conclude(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    inspectionId: string | undefined,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode concluir esta visita');
    }
    if (visit.status !== 'confirmado') {
      throw new ConflictException('Visita precisa estar confirmada para ser concluída');
    }

    if (inspectionId) {
      const inspectionResult = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM inspections WHERE id = $1',
        [inspectionId],
      );
      const inspection = inspectionResult.rows[0];
      if (!inspection || inspection.tenant_id !== visit.tenant_id) {
        throw new ForbiddenException('inspection_id inválido para esta visita');
      }
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'concluido', inspection_id = $2 WHERE id = $1 RETURNING *`,
      [id, inspectionId ?? null],
    );
    return normalizeVisit(result.rows[0]);
  }

  private async findAndLock(client: PoolClient, id: string): Promise<VisitRequest> {
    const result = await client.query<VisitRequest>(
      'SELECT * FROM visit_requests WHERE id = $1 FOR UPDATE',
      [id],
    );
    const visit = result.rows[0];
    if (!visit) throw new NotFoundException('Visita não encontrada');
    return visit;
  }

  private async isTechnicianLinked(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM tenant_technicians tt
       JOIN technicians t ON t.id = tt.technician_id
       WHERE tt.tenant_id = $1 AND t.user_id = $2 AND tt.status = 'ativo'
       UNION
       SELECT 1 FROM tenant_partners tp
       JOIN partners p ON p.id = tp.partner_id
       WHERE tp.tenant_id = $1 AND p.user_id = $2 AND tp.status = 'ativo'`,
      [tenantId, technicianUserId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
