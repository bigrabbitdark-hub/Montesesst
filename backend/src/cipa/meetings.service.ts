import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CipaCommittee, CipaMeeting, normalizeMeeting } from './committees.service';
import { DocumentsService } from '../documents/documents.service';
import { buildAtaPdf } from './ata-pdf.util';
import { mapPgError } from '../common/pg-error.util';
import { assertUserInTenant } from './tenant-guards';

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

// Shape específico da query com LEFT JOIN cipa_members usada em
// approveAta pra montar o PDF — achado da revisão final (Fix 3): a
// query original sem join só conseguia imprimir nome_livre ou o
// placeholder "(membro da CIPA)", nunca o nome de um membro cadastrado
// de verdade (o caso comum). Tipo dedicado em vez de reaproveitar
// CipaMeetingParticipant porque o formato da linha é diferente (tem
// member_nome, não tem id/cipa_member_id).
export interface AtaParticipantRow {
  nome_livre: string | null;
  member_nome: string | null;
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

    // Achado da revisão final (Fix 6): responsavel_user_id é opcional
    // aqui, mas quando informado precisa pertencer ao mesmo tenant —
    // FK-only não pega um responsável de outro tenant/sem vínculo real.
    if (responsavelUserId) {
      await assertUserInTenant(client, responsavelUserId, tenantId);
    }

    try {
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
    } catch (err) {
      mapPgError(err);
    }
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
    const lockResult = await client.query<{ status_ata: string; tenant_id: string }>(
      'SELECT status_ata, tenant_id FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de editar');
    }

    // Achado da revisão final (Fix 6): mesma checagem de
    // createExtraordinaria — responsavel_user_id opcional, mas quando
    // informado precisa pertencer ao mesmo tenant da reunião.
    if (data.responsavel_user_id !== undefined && data.responsavel_user_id !== null) {
      await assertUserInTenant(client, data.responsavel_user_id as string, meeting.tenant_id);
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

    try {
      const result = await client.query<CipaMeeting>(
        `UPDATE cipa_meetings SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      return normalizeMeeting(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async setParticipants(
    client: PoolClient,
    meetingId: string,
    participants: { cipa_member_id?: string; nome_livre?: string; presente: boolean }[],
  ): Promise<CipaMeetingParticipant[]> {
    // Achado da revisão final (Fix 1 — Critical): esta rota não tinha
    // NENHUM guard — nem checagem de existência da reunião, nem FOR
    // UPDATE, nem o bloqueio de "ata aprovada = trava edição" que
    // update() já tem. Um PUT direto em /participants dava pra reescrever
    // a lista de presença de uma ata já aprovada sem deixar rastro (essa
    // rota também não gerava log de auditoria — corrigido separadamente
    // em AUDITED_METHODS de audit.interceptor.ts). Mesmo padrão de lock
    // de MeetingsService.update/approveAta.
    const lockResult = await client.query<{ status_ata: string; tenant_id: string; company_unit_id: string }>(
      'SELECT status_ata, tenant_id, company_unit_id FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [meetingId],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de editar');
    }

    // Achado da revisão final (Fix 5 + Fix 10b): cipa_member_id é
    // client-supplied — sem validar, um id de membro de OUTRO tenant (ou
    // de outro estabelecimento do mesmo tenant) passa pelo FK-only
    // (cipa_members existe, só isso) e a reunião fica com um participante
    // que não é dela. Uma query batelada só, não N+1 — valida tenant E
    // company_unit_id juntos (Fix 10b: não bastava só o tenant, o membro
    // também precisa ser do mesmo estabelecimento da reunião).
    const memberIds = [...new Set(participants.map((p) => p.cipa_member_id).filter((v): v is string => !!v))];
    if (memberIds.length > 0) {
      const memberCheck = await client.query(
        'SELECT id FROM cipa_members WHERE id = ANY($1) AND tenant_id = $2 AND company_unit_id = $3',
        [memberIds, meeting.tenant_id, meeting.company_unit_id],
      );
      if (memberCheck.rows.length !== memberIds.length) {
        throw new BadRequestException(
          'Um ou mais membros informados não pertencem a esta empresa/estabelecimento',
        );
      }
    }

    try {
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
    } catch (err) {
      mapPgError(err);
    }
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
    const meetingRow = lockResult.rows[0];
    if (!meetingRow) throw new NotFoundException('Reunião não encontrada');
    if (meetingRow.status_ata === 'aprovada') {
      throw new ConflictException('Ata já está aprovada');
    }
    // Achado da revisão final (Fix 2): sem normalizar aqui, `data`/
    // `proxima_reuniao_data` chegam no PDF como objeto Date bruto do
    // node-pg, e ata-pdf.util.ts interpola isso direto — produzindo algo
    // como "Tue Mar 10 2026 00:00:00 GMT+0000 (...)" em vez de
    // "2026-03-10" no documento legal de verdade.
    const meeting = normalizeMeeting(meetingRow);

    const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
      meeting.tenant_id,
    ]);
    // Achado da revisão final (Fix 3): a query original (`SELECT *`, sem
    // join) só permitia ao PDF imprimir nome_livre ou o placeholder
    // "(membro da CIPA)" — todo participante que é um membro cadastrado
    // de verdade (o caso comum) aparecia anônimo no documento legal.
    const participantsResult = await client.query<AtaParticipantRow>(
      `SELECT p.nome_livre, p.presente, m.nome AS member_nome
       FROM cipa_meeting_participants p
       LEFT JOIN cipa_members m ON m.id = p.cipa_member_id
       WHERE p.meeting_id = $1`,
      [id],
    );

    const pdfBuffer = await buildAtaPdf(meeting, tenantResult.rows[0].name, participantsResult.rows);
    const fileName = `ata-${meeting.tipo}-${meeting.numero ?? meeting.id.slice(0, 8)}.pdf`;

    // Achado da revisão final (Fix 8a): sem companyUnitId aqui, o
    // documento gerado não fica filtrável por estabelecimento — a
    // reunião de origem sempre tem um (NOT NULL desde a migration 0024).
    const document = await documents.upload(client, {
      tenantId: meeting.tenant_id,
      category: 'cipa_ata',
      title: `Ata — ${meeting.tipo === 'ordinaria' ? `${meeting.numero}ª Reunião Ordinária` : meeting.titulo}`,
      file: { buffer: pdfBuffer, mimetype: 'application/pdf', originalname: fileName, size: pdfBuffer.length },
      uploadedByUserId: userId,
      uploadedByRole: 'empresa',
      companyUnitId: meeting.company_unit_id,
    });

    try {
      // Achado da revisão final (Fix 8b): sem ata_document_id, a única
      // forma de achar a ata aprovada de uma reunião era casar por texto
      // de `title` — reabrir+reaprovar produzia dois documentos cipa_ata
      // indistinguíveis pra mesma reunião. Grava o link aqui.
      const result = await client.query<CipaMeeting>(
        `UPDATE cipa_meetings
         SET status_ata = 'aprovada', aprovado_por_user_id = $2, aprovado_em = now(), ata_document_id = $3
         WHERE id = $1 RETURNING *`,
        [id, userId, document.id],
      );
      return normalizeMeeting(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async reopenAta(client: PoolClient, id: string): Promise<CipaMeeting> {
    // Fix 8b: zera o link pra ata aprovada anterior — reaprovar depois de
    // reabrir grava um ata_document_id novo (do documento novo gerado por
    // approveAta), sem deixar o documento antigo (stale) sendo tratado
    // como "o" atual.
    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET status_ata = 'rascunho', aprovado_por_user_id = NULL, aprovado_em = NULL, ata_document_id = NULL
       WHERE id = $1 RETURNING *`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundException('Reunião não encontrada');
    return normalizeMeeting(result.rows[0]);
  }
}
