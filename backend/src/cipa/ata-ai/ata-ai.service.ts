import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { AUDIO_TRANSCRIPTION_SERVICE, AudioTranscriptionService } from './audio-transcription.interface';
import { ATA_EXTRACTOR, AtaExtractor } from './ata-extractor.interface';

export interface CipaMeetingAtaDraft {
  id: string;
  meeting_id: string;
  tenant_id: string;
  company_unit_id: string;
  status: 'processando' | 'concluido' | 'falhou';
  transcript: string | null;
  draft_pauta: string | null;
  draft_discussoes: string | null;
  draft_deliberacoes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AudioUpload {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

interface TenantContext {
  userId: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class AtaAiService {
  private readonly logger = new Logger(AtaAiService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(AUDIO_TRANSCRIPTION_SERVICE) private readonly transcriber: AudioTranscriptionService,
    @Inject(ATA_EXTRACTOR) private readonly extractor: AtaExtractor,
  ) {}

  // Roda dentro da transação da requisição original (req.withTenantContext,
  // já vem de fora). Valida a reunião, tranca a linha (mesmo padrão de
  // MeetingsService.update/setParticipants) e cria/substitui o rascunho com
  // status 'processando'. O processamento de verdade roda depois, fora
  // desta transação — ver processDraft.
  async createDraft(client: PoolClient, meetingId: string): Promise<CipaMeetingAtaDraft> {
    const meetingResult = await client.query<{ status_ata: string; tenant_id: string; company_unit_id: string }>(
      'SELECT status_ata, tenant_id, company_unit_id FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [meetingId],
    );
    const meeting = meetingResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de gerar um rascunho por áudio');
    }

    const existingResult = await client.query<{ status: string }>(
      'SELECT status FROM cipa_meeting_ata_drafts WHERE meeting_id = $1 FOR UPDATE',
      [meetingId],
    );
    if (existingResult.rows[0]?.status === 'processando') {
      throw new ConflictException('Já existe uma transcrição em andamento para esta reunião');
    }

    const result = await client.query<CipaMeetingAtaDraft>(
      `INSERT INTO cipa_meeting_ata_drafts (meeting_id, tenant_id, company_unit_id, status)
       VALUES ($1, $2, $3, 'processando')
       ON CONFLICT (meeting_id) DO UPDATE SET
         status = 'processando', transcript = NULL, draft_pauta = NULL,
         draft_discussoes = NULL, draft_deliberacoes = NULL, error_message = NULL,
         updated_at = now()
       RETURNING *`,
      [meetingId, meeting.tenant_id, meeting.company_unit_id],
    );
    return result.rows[0];
  }

  async getDraft(client: PoolClient, meetingId: string): Promise<CipaMeetingAtaDraft | null> {
    const result = await client.query<CipaMeetingAtaDraft>(
      'SELECT * FROM cipa_meeting_ata_drafts WHERE meeting_id = $1',
      [meetingId],
    );
    return result.rows[0] ?? null;
  }

  // Chamado SEM await pelo controller, depois que a resposta HTTP do
  // upload já foi enviada (ver MeetingsController.uploadAtaAudio). Abre
  // suas próprias transações curtas — uma por escrita — em vez de segurar
  // uma conexão do pool aberta durante as chamadas de IA, que podem levar
  // minutos num áudio longo (este backend tem só DB_POOL_MAX=10 conexões
  // — ver docker-compose.yml).
  async processDraft(ctx: TenantContext, meetingId: string, audio: AudioUpload): Promise<void> {
    try {
      const transcript = await this.transcriber.transcribe(audio.buffer, audio.mimetype, audio.filename);
      await this.db.withTenantContext(ctx, (client) =>
        client.query(
          `UPDATE cipa_meeting_ata_drafts SET transcript = $2, updated_at = now() WHERE meeting_id = $1`,
          [meetingId, transcript],
        ),
      );

      const draft = await this.extractor.extract(transcript);
      await this.db.withTenantContext(ctx, (client) =>
        client.query(
          `UPDATE cipa_meeting_ata_drafts
           SET status = 'concluido', draft_pauta = $2, draft_discussoes = $3, draft_deliberacoes = $4, updated_at = now()
           WHERE meeting_id = $1`,
          [meetingId, draft.pauta, draft.discussoes, draft.deliberacoes],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao processar rascunho de ata da reunião ${meetingId}`, (err as Error).stack);
      const message = err instanceof Error ? err.message : 'Falha desconhecida ao processar o áudio';
      await this.db
        .withTenantContext(ctx, (client) =>
          client.query(
            `UPDATE cipa_meeting_ata_drafts SET status = 'falhou', error_message = $2, updated_at = now() WHERE meeting_id = $1`,
            [meetingId, message],
          ),
        )
        .catch((updateErr) =>
          this.logger.error(`Falha ao gravar status de erro do rascunho ${meetingId}`, (updateErr as Error).stack),
        );
    }
  }
}
