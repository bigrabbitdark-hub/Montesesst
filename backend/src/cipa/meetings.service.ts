import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CipaCommittee, CipaMeeting, normalizeMeeting } from './committees.service';
import { DocumentsService } from '../documents/documents.service';
import { buildAtaPdf } from './ata-pdf.util';

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

const UPDATABLE_FIELDS = [
  'data', 'hora', 'local', 'modalidade', 'responsavel_user_id', 'status',
  'chk_pauta_definida', 'chk_participantes_convocados', 'chk_local_confirmado',
  'chk_presenca_registrada', 'chk_assuntos_discutidos', 'chk_decisoes_registradas',
  'chk_ata_criada', 'chk_acoes_distribuidas', 'chk_pendencias_registradas',
  'pauta', 'discussoes', 'deliberacoes', 'proxima_reuniao_data',
] as const;

@Injectable()
export class MeetingsService {
  async createExtraordinaria(
    client: PoolClient,
    tenantId: string,
    committeeId: string,
    titulo: string,
    data: string | undefined,
    hora: string | undefined,
    local: string | undefined,
    modalidade: string | undefined,
    motivo: string | undefined,
    responsavelUserId: string | undefined,
  ): Promise<CipaMeeting> {
    // cipa_meetings.company_unit_id é NOT NULL (migration 0024, aplicada
    // após o texto original desta task ter sido escrito) — deriva do
    // comitê, mesmo padrão de CommitteesService.generateMeetings.
    const committeeResult = await client.query<CipaCommittee>(
      'SELECT * FROM cipa_committees WHERE id = $1',
      [committeeId],
    );
    const committee = committeeResult.rows[0];
    if (!committee) throw new NotFoundException('Gestão da CIPA não encontrada');

    const result = await client.query<CipaMeeting>(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data, hora, local, modalidade, motivo, responsavel_user_id)
       VALUES ($1, $2, $3, 'extraordinaria', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        tenantId,
        committeeId,
        committee.company_unit_id,
        titulo,
        data ?? null,
        hora ?? null,
        local ?? null,
        modalidade ?? null,
        motivo ?? null,
        responsavelUserId ?? null,
      ],
    );
    return normalizeMeeting(result.rows[0]);
  }

  async findAll(client: PoolClient, committeeId?: string): Promise<CipaMeeting[]> {
    if (committeeId) {
      const result = await client.query<CipaMeeting>(
        `SELECT * FROM cipa_meetings WHERE committee_id = $1 ORDER BY COALESCE(data, created_at::date)`,
        [committeeId],
      );
      return result.rows.map(normalizeMeeting);
    }
    const result = await client.query<CipaMeeting>(
      `SELECT * FROM cipa_meetings ORDER BY COALESCE(data, created_at::date)`,
    );
    return result.rows.map(normalizeMeeting);
  }

  async findOne(client: PoolClient, id: string): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>('SELECT * FROM cipa_meetings WHERE id = $1', [id]);
    const meeting = result.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    return normalizeMeeting(meeting);
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaMeeting> {
    const lockResult = await client.query<{ status_ata: string }>(
      'SELECT status_ata FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de editar');
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      return this.findOne(client, id);
    }

    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return normalizeMeeting(result.rows[0]);
  }

  async setParticipants(
    client: PoolClient,
    meetingId: string,
    participants: { cipa_member_id?: string; nome_livre?: string; presente: boolean }[],
  ): Promise<CipaMeetingParticipant[]> {
    await client.query('DELETE FROM cipa_meeting_participants WHERE meeting_id = $1', [meetingId]);
    if (participants.length === 0) return [];

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const p of participants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(meetingId, p.cipa_member_id ?? null, p.nome_livre ?? null, p.presente);
    }

    const result = await client.query<CipaMeetingParticipant>(
      `INSERT INTO cipa_meeting_participants (meeting_id, cipa_member_id, nome_livre, presente)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );
    return result.rows;
  }

  async approveAta(
    client: PoolClient,
    id: string,
    userId: string,
    documents: DocumentsService,
  ): Promise<CipaMeeting> {
    const lockResult = await client.query<CipaMeeting>(
      'SELECT * FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já está aprovada');
    }

    const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
      meeting.tenant_id,
    ]);
    const participantsResult = await client.query<CipaMeetingParticipant>(
      'SELECT * FROM cipa_meeting_participants WHERE meeting_id = $1',
      [id],
    );

    const pdfBuffer = await buildAtaPdf(meeting, tenantResult.rows[0].name, participantsResult.rows);
    const fileName = `ata-${meeting.tipo}-${meeting.numero ?? meeting.id.slice(0, 8)}.pdf`;

    await documents.upload(client, {
      tenantId: meeting.tenant_id,
      category: 'cipa_ata',
      title: `Ata — ${meeting.tipo === 'ordinaria' ? `${meeting.numero}ª Reunião Ordinária` : meeting.titulo}`,
      file: { buffer: pdfBuffer, mimetype: 'application/pdf', originalname: fileName, size: pdfBuffer.length },
      uploadedByUserId: userId,
      uploadedByRole: 'empresa',
    });

    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET status_ata = 'aprovada', aprovado_por_user_id = $2, aprovado_em = now()
       WHERE id = $1 RETURNING *`,
      [id, userId],
    );
    return normalizeMeeting(result.rows[0]);
  }

  async reopenAta(client: PoolClient, id: string): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET status_ata = 'rascunho', aprovado_por_user_id = NULL, aprovado_em = NULL
       WHERE id = $1 RETURNING *`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundException('Reunião não encontrada');
    return normalizeMeeting(result.rows[0]);
  }
}
