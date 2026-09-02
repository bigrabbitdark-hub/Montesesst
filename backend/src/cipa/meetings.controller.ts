import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { MeetingsService } from './meetings.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateExtraordinariaDto } from './dto/create-extraordinaria.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { SetParticipantsDto } from './dto/set-participants.dto';
import { AtaAiService } from './ata-ai/ata-ai.service';

@Controller('cipa/meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly documents: DocumentsService,
    private readonly ataAi: AtaAiService,
  ) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateExtraordinariaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.createExtraordinaria(
        client, req.user.tenantId, dto.committee_id, dto.titulo, dto.data, dto.hora,
        dto.local, dto.modalidade, dto.motivo, dto.responsavel_user_id,
      ),
    );
  }

  @Get()
  findAll(@Query('committee_id') committeeId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findAll(client, committeeId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findOne(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.update(client, id, dto as Record<string, unknown>));
  }

  @Get(':id/participants')
  findParticipants(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findParticipants(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put(':id/participants')
  setParticipants(@Param('id') id: string, @Body() dto: SetParticipantsDto, @Req() req: any) {
    for (const p of dto.participants) {
      if ((!p.cipa_member_id && !p.nome_livre) || (p.cipa_member_id && p.nome_livre)) {
        throw new BadRequestException('Cada participante precisa de exatamente um entre cipa_member_id e nome_livre');
      }
    }
    return req.withTenantContext((client: any) => this.meetings.setParticipants(client, id, dto.participants));
  }

  @Roles('empresa')
  @Post(':id/aprovar-ata')
  approveAta(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.approveAta(client, id, req.user.id, this.documents),
    );
  }

  @Roles('empresa')
  @Post(':id/reabrir-ata')
  reopenAta(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.reopenAta(client, id));
  }

  private static readonly ALLOWED_AUDIO_MIME_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a',
    'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  ];

  @Roles('empresa')
  @RateLimit({
    limit: envInt('ATA_AUDIO_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('ATA_AUDIO_RATE_LIMIT_WINDOW_SECONDS', 86400),
    keyBy: 'ip',
  })
  @Post(':id/ata-audio')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadAtaAudio(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    if (!MeetingsController.ALLOWED_AUDIO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato de áudio não suportado. Envie mp3, m4a, ogg ou wav.');
    }

    const draft = await req.withTenantContext((client: any) => this.ataAi.createDraft(client, id));

    // Dispara o processamento em segundo plano (sem aguardar) — a resposta
    // HTTP volta na hora, o frontend acompanha via GET :id/ata-ai-draft
    // (polling). Contexto de tenant capturado como valores simples agora,
    // não reaproveita a conexão da transação de createDraft (já volta pro
    // pool assim que este método retornar).
    void this.ataAi.processDraft(
      { userId: req.user.id, tenantId: req.user.tenantId, role: req.user.role },
      id,
      { buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname },
    );

    return draft;
  }

  @Get(':id/ata-ai-draft')
  async getAtaAiDraft(@Param('id') id: string, @Req() req: any) {
    const draft = await req.withTenantContext((client: any) => this.ataAi.getDraft(client, id));
    if (!draft) throw new NotFoundException('Nenhum rascunho de ata por áudio para esta reunião');
    return draft;
  }
}
