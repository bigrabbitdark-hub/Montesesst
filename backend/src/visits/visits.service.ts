import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

export interface VisitRequest {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  requested_by_user_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  company_unit_id: string | null;
  google_event_id: string | null;
  google_meet_link: string | null;
  motivo: string | null;
  inspection_id: string | null;
  created_at: string;
  updated_at: string;
}

// Colunas `date`/`time` do Postgres chegam via node-pg como objeto Date
// ou string "HH:MM:SS" — mesma armadilha já documentada em várias fases
// deste projeto (dashboard.service.ts, inspections.service.ts). Normaliza
// os 4 campos sensíveis a formato antes de qualquer VisitRequest sair
// pro controller.
export function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

export function toTimeString(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

export function normalizeVisit(row: VisitRequest): VisitRequest {
  return {
    ...row,
    preferred_date: toDateString(row.preferred_date),
    confirmed_date: toDateString(row.confirmed_date),
    preferred_time: toTimeString(row.preferred_time),
    confirmed_time: toTimeString(row.confirmed_time),
  };
}

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  private async assertCompanyUnitBelongsToTenant(
    client: PoolClient,
    companyUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  async create(
    client: PoolClient,
    tenantId: string,
    requestedByUserId: string,
    technicianUserId: string,
    type: 'reuniao' | 'visita',
    preferredDate: string | undefined,
    preferredTime: string | undefined,
    companyUnitId: string | undefined,
    motivo: string | undefined,
  ): Promise<VisitRequest> {
    const linked = await this.isTechnicianLinked(client, tenantId, technicianUserId);
    if (!linked) {
      throw new ForbiddenException('Técnico não está vinculado a esta empresa');
    }
    if (type === 'visita' && companyUnitId) {
      await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);
    }

    const result = await client.query<VisitRequest>(
      `INSERT INTO visit_requests
         (tenant_id, technician_user_id, requested_by_user_id, type, preferred_date, preferred_time, company_unit_id, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        tenantId,
        technicianUserId,
        requestedByUserId,
        type,
        preferredDate ?? null,
        preferredTime ?? null,
        type === 'visita' ? (companyUnitId ?? null) : null,
        motivo ?? null,
      ],
    );
    return normalizeVisit(result.rows[0]);
  }

  async findAll(client: PoolClient, user: AuthenticatedUser): Promise<VisitRequest[]> {
    if (user.role === 'admin') {
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
    confirmedTime: string | undefined,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode confirmar esta visita');
    }
    if (visit.status !== 'solicitado') {
      throw new ConflictException('Visita não está aguardando confirmação');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'confirmado', confirmed_date = $2, confirmed_time = $3
       WHERE id = $1 RETURNING *`,
      [id, confirmedDate, confirmedTime ?? null],
    );
    let confirmed = normalizeVisit(result.rows[0]);

    try {
      const startTime = confirmedTime || '09:00';
      const startDateTimeIso = `${confirmedDate}T${startTime}:00`;
      const [hours, minutes] = startTime.split(':').map(Number);
      const endDate = new Date(`${confirmedDate}T${startTime}:00`);
      endDate.setHours(hours + 1, minutes);
      const endDateTimeIso = endDate.toISOString().slice(0, 19);

      let location: string | null = null;
      if (confirmed.type === 'visita' && confirmed.company_unit_id) {
        const unitResult = await client.query<{
          address_street: string;
          address_number: string | null;
          address_city: string;
          address_state: string;
        }>(
          'SELECT address_street, address_number, address_city, address_state FROM company_units WHERE id = $1',
          [confirmed.company_unit_id],
        );
        const unit = unitResult.rows[0];
        if (unit) {
          location = `${unit.address_street}${unit.address_number ? `, ${unit.address_number}` : ''} — ${unit.address_city}/${unit.address_state}`;
        }
      }

      const event = await this.googleCalendar.createEvent(client, technicianUserId, {
        type: confirmed.type,
        summary: confirmed.type === 'reuniao' ? 'Reunião — Montese SST' : 'Visita técnica — Montese SST',
        description: confirmed.motivo || 'Agendado via Montese SST',
        startDateTimeIso,
        endDateTimeIso,
        location,
      });

      if (event) {
        await this.setGoogleEvent(client, id, event.eventId, event.meetLink);
        confirmed = { ...confirmed, google_event_id: event.eventId, google_meet_link: event.meetLink };
      }
    } catch (err) {
      // Nunca derruba a confirmação por causa do Google — mesmo padrão
      // de resiliência já usado na geração do PDF de visita técnica.
      this.logger.warn(`Falha ao criar evento no Google Calendar pra visita ${id}: ${(err as Error).message}`);
    }

    return confirmed;
  }

  async cancel(client: PoolClient, id: string, user: AuthenticatedUser): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
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

  async setGoogleEvent(
    client: PoolClient,
    id: string,
    googleEventId: string,
    googleMeetLink: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE visit_requests SET google_event_id = $2, google_meet_link = $3 WHERE id = $1`,
      [id, googleEventId, googleMeetLink],
    );
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
